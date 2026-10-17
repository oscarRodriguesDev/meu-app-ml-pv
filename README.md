# Mercado Livre → ClickUp

Next.js com App Router e TypeScript para sincronizar devoluções de uma conta de vendedor com a lista **901717874275** a cada 15 minutos. OAuth com PKCE, tokens criptografados, renovação e vínculos persistentes impedem criações repetidas.

**Acesso ao Supabase por HTTPS e chaves da API. Não é necessário `DATABASE_URL`, senha PostgreSQL, Prisma ou acesso TCP em produção.**

O projeto precisa de uma hospedagem Node.js (como Vercel) e do Supabase para guardar dados e executar o cron. O build não instala nem altera o banco. A conexão OAuth real depende do domínio de produção e da autorização do vendedor.

## Começar

1. No **SQL Editor do Supabase**, execute o arquivo [supabase/install.sql](supabase/install.sql). Ele aplica as versões pendentes em uma transação e pode ser reaplicado sem recriar tabelas públicas nem apagar os dados existentes.
2. Configure as variáveis de `.env.example` no ambiente do Next.js.
3. Execute `npm ci` e `npm run supabase:check` para verificar a chave e a instalação.
4. Publique o aplicativo, configure o callback no Mercado Livre e autorize a conta pelo navegador.
5. Ative o cron de 15 minutos conforme [docs/SUPABASE.md](docs/SUPABASE.md).

Para desenvolvimento, copie `.env.example` para `.env.local` e execute `npm run dev`. Requisitos: Node.js 22.19+ (recomendado 24 LTS) e npm. A aplicação continua acessando o projeto Supabase por HTTPS. Use projeto e chaves separados para desenvolvimento/previews.

## Variáveis

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL` | Origem HTTPS do projeto, como `https://SEU_PROJETO.supabase.co`, sem caminhos ou query. |
| `SUPABASE_SECRET_KEY` | Chave secreta `sb_secret_…` do servidor. O transporte a envia em `apikey`, sem tratá-la como JWT. Também aceita a chave legada `service_role`. |
| `SUPABASE_PUBLISHABLE_KEY` | Opcional. Prevista para clientes públicos; não é usada para acessar tokens ou sincronizar. |
| `SUPABASE_JWKS_URL` | Opcional. Por padrão, `SUPABASE_URL/auth/v1/.well-known/jwks.json`. Reservada para validar JWTs se Supabase Auth for adotado. O serviço atual não usa Supabase Auth e não busca esse endereço. |
| `CLICKUP_API_TOKEN` | Token com acesso de leitura/criação/edição à lista. |
| `CLICKUP_LIST_ID` | `901717874275` (também é o padrão). |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | Credenciais da aplicação Mercado Livre. |
| `ML_REDIRECT_URI` | URL exata `https://SEU_DOMINIO/api/oauth/callback`. |
| `TOKEN_ENCRYPTION_KEY` | Chave AES de 32 bytes em base64: `openssl rand -base64 32`. |
| `ADMIN_SECRET` | Senha administrativa de pelo menos 32 caracteres: `openssl rand -hex 32`. |
| `CRON_SECRET` | Outro segredo, diferente do administrativo; usado pelo cron. |
| `ML_SELLER_ID` | Opcional: fixa o vendedor autorizado desde a primeira conexão. |
| `ML_SYNC_FROM` | Início do histórico inicial. Padrão `2000-01-01T00:00:00.000Z`. Reduzir esse período limita deliberadamente a cobertura histórica. |

Nunca use `NEXT_PUBLIC_` para a chave secreta, tokens ou segredos administrativos. As quatro variáveis do Supabase podem ser cadastradas com os nomes acima; apenas URL e chave secreta são necessárias para a persistência atual. Chave publicável e JWKS não substituem a chave secreta, a criptografia dos tokens ou a autenticação administrativa.

Em ambientes com rede restrita, permita o **host HTTPS do projeto Supabase, porta 443**, além de `api.mercadolibre.com` e `api.clickup.com`. Não é necessário liberar PostgreSQL/5432. O transporte respeita os proxies e certificados de confiança do ambiente e mantém TLS habilitado. Um segredo cadastrado em outra plataforma não é transferido automaticamente para a hospedagem.

## OAuth e callback provisório

Depois de definir o domínio da hospedagem, substitua o callback provisório no painel Mercado Livre por:

```text
https://SEU_DOMINIO/api/oauth/callback
```

Defina a mesma URL em `ML_REDIRECT_URI`. O caminho é sem barra final, query ou fragmento. Habilite PKCE e as permissões de leitura de pós-venda/reclamações e acesso offline/renovação oferecidas pela aplicação Mercado Livre.

Abra `/` e clique em **Conectar Mercado Livre**, ou acesse `/api/oauth/start`. No diálogo HTTP Basic, use o usuário `admin` e a senha `ADMIN_SECRET`. O endpoint gera `state`, cookie e PKCE S256 a cada tentativa e redireciona ao Mercado Livre. O link completo não é fixo. Autorize a conta correta; o callback confirma a conexão. Consulte `/api/status` e faça um `POST /api/sync` autenticado antes de habilitar o cron.

O estado OAuth dura dez minutos, tem hash persistido e é vinculado a um cookie HttpOnly/SameSite=Lax. O verificador é criptografado; o consumo do estado ocorre atomicamente uma única vez. O callback não precisa de HTTP Basic. Em desenvolvimento, HTTP só é aceito para localhost; se o Mercado Livre exigir HTTPS, use um domínio de desenvolvimento cadastrado.

O vendedor da primeira conexão fica fixado no banco. Reconectar outro vendedor é rejeitado. Uma reconexão da mesma conta preserva os vínculos e o checkpoint. Os tokens ficam criptografados com AES-256-GCM. O acesso é renovado dois minutos antes de expirar ou após um 401. O refresh token rotacionado é persistido antes das próximas consultas. Uma renovação ambígua deixa `refresh_pending=true` e exige reconectar, evitando reutilizar um refresh token de uso único.

## Supabase, concorrência e idempotência

As tabelas ficam no schema privado `ml_integration`, com RLS habilitada e sem acesso direto das roles da API. A função `public.ml_service` expõe operações fixas, nunca SQL arbitrário; somente `service_role` pode executá-la. A chave secreta do Supabase autoriza essa role. `anon`, `authenticated` e `PUBLIC` não têm execução, mesmo conhecendo a URL da função. A função usa `SECURITY DEFINER`, `search_path` vazio e nomes qualificados para alcançar as tabelas privadas.

Callback e sincronização adquirem um bloqueio persistente com proprietário UUID e validade de 120 segundos. Há renovação a cada 20 segundos e antes das mutações externas. Cada operação protegida verifica o proprietário/validade e bloqueia a linha até o final da transação SQL. Uma execução que perdeu o bloqueio não consegue gravar estado antigo. Se um processo morrer, o bloqueio expira; não depende de uma conexão TCP de sessão. Uma execução concorrente retorna `status: skipped`.

A busca consulta reclamações do vendedor respondente, abertas e encerradas, por `last_updated`. Identifica `type=return` e `related_entities` com `return`, buscando detalhes quando necessário. O objeto vem de `/post-purchase/v2/claims/{claim_id}/returns`. A busca inicial começa em `ML_SYNC_FROM`; depois usa checkpoint com sobreposição de 15 minutos até o início da execução. Janelas densas são subdivididas para respeitar `offset + limit < 10000`. Uma janela indivisível excessivamente densa gera erro explícito.

Devoluções conhecidas são consultadas em cada ciclo, mesmo se a reclamação não foi atualizada. O checkpoint só avança quando todas as candidatas foram processadas; vínculos parciais já salvos são preservados. Como a busca externa não oferece snapshot transacional, a sobreposição compensa repetições/mudanças entre páginas.

O vínculo único `(seller_id, list_id, return_id)` guarda `task_id` e hash do conteúdo. Conteúdo inalterado não causa PUT. O nome e a descrição da tarefa trazem `[ml-return:SELLER_ID:RETURN_ID]`, usada para recuperar tarefas após falhas locais. A busca de reconciliação percorre todas as páginas, incluindo tarefas fechadas, arquivadas e presentes em múltiplas listas.

Antes de criar uma tarefa, a intenção é persistida com `creation_uncertain=true`. O POST do ClickUp não é repetido automaticamente. Se houver timeout, resposta inválida, encerramento do processo ou falha ao salvar o ID, a próxima execução procura a marca. Se encontrar uma tarefa, recupera o vínculo; **se não encontrar, pausa aquela devolução para inspeção**. Essa escolha evita duplicação por resposta tardia ou visibilidade eventual. Marcas duplicadas e conflitos geram erro. Uma tarefa vinculada apagada/inacessível não é recriada automaticamente.

As chamadas RPC também não são repetidas automaticamente após uma resposta ambígua. Se a aquisição do bloqueio tiver sido confirmada no banco, mas sua resposta se perder, ele expira em até 120 segundos sem iniciar outro trabalho. GET/PUT das APIs têm retries limitados para rede, 429 e 5xx. Não há transação distribuída nem garantia externa de "exactly once"; mantenha o banco e as marcas e utilize uma única configuração de produção.

A integração gerencia somente nome e descrição da tarefa, com IDs, status, subtipo, estado do dinheiro, pedidos, itens, quantidades e rastreio. Não copia nome/endereço do comprador e não altera status nativo, responsáveis ou comentários do ClickUp.

## Hospedagem e cron

Na Vercel, importe este repositório com preset Next.js e Node.js 24. Use `npm ci` e `npm run build`; configure as variáveis no escopo Production. Confirme que a duração da função comporta a execução; as rotas solicitam até 300 segundos. Publicar não instala as tabelas: execute `supabase/install.sql` primeiro. Para o callback e o cron, o deploy precisa ser alcançável; os endpoints sensíveis verificam os próprios segredos.

O padrão é cron no Supabase, conforme [o guia](docs/SUPABASE.md). `supabase/schedule.sql` agenda `*/15 * * * *` e lê o domínio e `CRON_SECRET` do Vault. Só ative após publicar e autorizar o Mercado Livre. Não use `setInterval` para agendar funções serverless; o intervalo em `withLock` existe apenas para renovar o bloqueio enquanto uma requisição está em execução.

Para Vercel Cron, copie `deploy/vercel-cron.example.json` para `vercel.json` e use um plano que comporte a frequência (por exemplo Pro). Desative o cron do Supabase. A Vercel envia `Authorization: Bearer CRON_SECRET` quando o segredo está configurado. A frequência do cron externo não aumenta o limite de duração da função na Vercel.

Para servidor próprio, os arquivos systemd em `deploy/` executam o Next.js e um timer de quarto de hora. Use `/opt/ml-clickup`, um usuário de serviço `ml-clickup`, um arquivo protegido `/etc/ml-clickup.env` e um proxy HTTPS para localhost:3000. Ajuste `/usr/bin/npm` à instalação e dê escrita em `.next` ao serviço. Instale as unidades e ative `ml-clickup.service` e `ml-clickup-sync.timer`. O script `deploy/sync.sh` envia o Bearer por stdin do curl, sem colocar o segredo na URL. Escolha um único agendador.

Em uma atualização da versão antiga com conexão PostgreSQL de sessão, desative o cron, aplique o SQL e publique o código novo antes de reativar. Não mantenha os dois protocolos de bloqueio em execução simultaneamente.

## Endpoints e operação

| Endpoint | Autenticação | Uso |
| --- | --- | --- |
| `GET /` | Pública | Instruções e link de conexão. |
| `GET /api/health` | Pública | Liveness; não verifica banco ou APIs. |
| `GET /api/oauth/start` | Admin | Inicia OAuth/PKCE. |
| `GET /api/oauth/callback` | Estado + cookie | Retorno OAuth. |
| `GET /api/status` | Admin | Conexão, últimas 20 execuções e intenções incertas, sem tokens. |
| `GET /api/diagnostics/ml` | Admin | Verificação da identidade da conta, filtros, datas e ordenação, sem criar tarefas ou avançar o checkpoint. |
| `POST /api/sync` | Admin | Sincronização manual. |
| `GET /api/cron/sync` | Bearer `CRON_SECRET` | Sincronização agendada. |

Admin aceita HTTP Basic `admin:ADMIN_SECRET` ou Bearer `ADMIN_SECRET`. Não passe segredos na URL. Falhas de sincronização retornam 503 com código sanitizado; concorrência retorna 200/skipped. Monitoramento funcional deve verificar `/api/status`, não apenas `/api/health`.

Para `OAUTH_START_FAILED`, consulte `cause`, `action` e `issues` na resposta e o evento `oauth_start_failed` nos logs da Vercel. `issues` contém apenas nomes de variáveis e sua condição, sem valores. O início do OAuth valida somente as configurações necessárias a esse fluxo; ClickUp e cron são validados na sincronização. Veja [o diagnóstico de configuração](docs/SUPABASE.md#diagnosticar-falha-antes-de-abrir-o-mercado-livre).

Para `ML_HTTP_400`, a resposta e o log `sync_failed` incluem a operação (`claims_search`, `claim_detail` ou `claim_returns`) e, quando reconhecida, uma categoria fixa como `date_range`, `seller_filter`, `sort` ou `pagination`. Mensagens brutas, IDs de recursos e parâmetros da URL não são registrados. O corpo de erro do Mercado Livre é lido com limite de 8 KB apenas para classificar a falha e é descartado. A busca consulta `status=opened` e `status=closed` separadamente, sempre com o vendedor e o mesmo intervalo, e reúne os resultados por ID. O filtro de estado evita a rejeição `atLeastOneFilterProvided` observada na API mesmo com o par de parâmetros `players` presente. Se qualquer busca falhar, o checkpoint não avança. A busca envia milissegundos e offset UTC explícito (`+00:00`), preservando o período completo e codificando o sinal `+` na query.

Abra `/api/diagnostics/ml` no navegador e autentique como administrador para verificar a identidade do token e testar, separadamente, filtro do vendedor, estados aberto/fechado, intervalo de datas e ordenação/paginação. Em erros 400 da busca, `validationMessage` mostra uma mensagem limitada com valores da consulta, números, URLs e credenciais ocultos; esse campo aparece somente na resposta autenticada e não entra nos logs. O diagnóstico pode renovar o token sob o mesmo bloqueio, mas não cria tarefas, não altera o checkpoint e não retorna dados de compradores. Se todas as verificações passarem, execute novamente a sincronização; uma falha em consulta de detalhes/devoluções aparecerá com sua própria operação.

`ML_NOT_CONNECTED` e `ML_REAUTH_REQUIRED` pedem conexão/reconexão. `SUPABASE_HTTP_404` geralmente indica instalação SQL ou cache da Data API pendente; `supabase/install.sql` notifica a recarga do schema. 401/403 pedem conferir chave, permissões e configuração da API. `SYNC_LOCK_LOST` interrompe gravações de uma execução sem bloqueio válido.

Para `CLICKUP_CREATE_UNCERTAIN`, aguarde outro ciclo e procure a marca, inclusive em tarefas fechadas/arquivadas. Se tiver sido movida, restaure a presença na lista. Somente após confirmar que nenhuma tarefa foi criada, com o cron desativado e nenhuma execução ativa, um operador pode remover a intenção `task_id IS NULL AND creation_uncertain=true` da devolução correspondente. Não remova linhas em caso de dúvida.

Guarde backups do banco e da chave AES. Trocar a chave sem recriptografar exige reconectar. Rotacione `CRON_SECRET` também no Vault e `SUPABASE_SECRET_KEY` na hospedagem. O código não registra tokens nem corpos de erros. Desative logs de query string do callback em proxies/APM: ele recebe `code` e `state`.

Uma execução morta pode ficar `running` no histórico; o bloqueio expira automaticamente. Para contas grandes, o trabalho sequencial pode exceder os 300 segundos ou os 15 minutos entre ciclos. Nesse caso dimensione um servidor/worker ou reduza conscientemente o histórico inicial; não aumente a frequência como compensação. Planeje retenção do histórico.

## Testes e manutenção

```bash
npm run typecheck
npm test
npm run build
npm run supabase:check
```

Os testes padrão executam as migrações e a função SQL real em PostgreSQL WASM (PGlite), com mocks somente das APIs. Cobrem PKCE, consumo/expiração de estado, criptografia, tokens rotativos, falha ambígua, 401/429, paginação, autenticação, criação/atualização, recuperação de falhas no commit, checkpoint, permissões da RPC, perda/expiração de bloqueio e heartbeat. O instalador único e o agendador também são executados em SQL nos testes; as extensões gerenciadas de cron/HTTP são simuladas.

A CI provisiona PostgreSQL real para o teste adicional de concorrência/constraints. Localmente, use um banco exclusivo terminado em `_test`:

```bash
TEST_DATABASE_URL=postgresql://postgres:senha@localhost:5432/ml_clickup_test npm test
```

`npm run db:bundle` regenera `supabase/install.sql` a partir de `db/`. `npm run db:migrate` permanece como ferramenta opcional para operadores com conexão PostgreSQL direta (`DATABASE_URL` e, se necessário, `DATABASE_SSL_CA`); essas variáveis não fazem parte da configuração do serviço por HTTPS. As tabelas e vínculos anteriores são preservados pelas migrações 002/003. O Compose local também é opcional, destinado aos testes/CLI, e não substitui a API Supabase usada em produção.

Referências: [busca de reclamações e parâmetros](https://developers.mercadolivre.com.br/pt_br/atributos/gerenciar-reclamacoes), [Mercado Livre OAuth](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao?nocache=true), [devoluções](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento/gerenciar-devolucoes), [ClickUp](https://developer.clickup.com/reference/gettasks), [chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [funções SQL](https://supabase.com/docs/guides/database/functions).
