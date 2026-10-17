# Mercado Livre → ClickUp

Serviço Next.js 16 com App Router e TypeScript para consultar as devoluções de **uma conta de vendedor** do Mercado Livre e criar/atualizar tarefas na lista **901717874275**. PostgreSQL guarda a conexão OAuth, o checkpoint, as execuções e os vínculos com as tarefas. O Supabase pode executar o agendamento a cada 15 minutos; há alternativas com Vercel Cron e systemd.

**Configuração escolhida: [Supabase — banco, migrações e cron](docs/SUPABASE.md).** O Next.js continua em uma hospedagem Node.js, como a Vercel.

## Situação da entrega

O código e os testes estão implementados. A lista do ClickUp foi consultada com sucesso, em leitura, usando a credencial disponível no ambiente. Não foram criadas tarefas de teste na sua lista. O código é versionado neste repositório. A hospedagem e o cron precisam ser ativados no seu provedor. A consulta real das devoluções depende de cadastrar a URL definitiva de callback e autorizar sua conta pelo navegador. O código não tenta usar a URL provisória nem adivinha seu domínio.

## Executar localmente

Requisitos: Node.js **22.19+** (recomendado 24 LTS), npm e PostgreSQL 17. Docker Compose é opcional.

```bash
npm ci
cp .env.example .env.local
# Preencha .env.local conforme a tabela abaixo.
docker compose up -d postgres
npm run db:migrate
npm run dev
```

As quatro variáveis de API já injetadas no ambiente não precisam ser copiadas nem impressas. As demais variáveis precisam ser definidas. `npm run db:migrate` lê `.env.local`, se existir; Next.js também carrega esse arquivo. As migrações são transacionais, versionadas e serializadas. A versão 002 move as tabelas para o schema privado `ml_integration` e preserva os dados existentes. Não é executada durante o build nem dentro de cada requisição.

| Variável | Configuração |
| --- | --- |
| `CLICKUP_API_TOKEN` | Token existente, com acesso de leitura e criação/edição à lista. Somente no servidor. |
| `CLICKUP_LIST_ID` | `901717874275`; esse é o padrão caso a variável esteja ausente. |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | Credenciais existentes da aplicação Mercado Livre. |
| `ML_REDIRECT_URI` | URL **exata**, por exemplo `https://seu-dominio.com/api/oauth/callback`. |
| `DATABASE_URL` | Conexão PostgreSQL direta ou pooler em **modo de sessão**; não use PgBouncer transaction/statement pooling. |
| `DATABASE_SSL_CA` | Opcional: conteúdo PEM do certificado CA do Supabase, para verificação TLS; aceita `\n` literais. |
| `TOKEN_ENCRYPTION_KEY` | Chave aleatória de 32 bytes em base64; gere com `openssl rand -base64 32`. Guarde em um gerenciador de segredos. |
| `ADMIN_SECRET` | Senha administrativa, mínimo 32 caracteres; gere com `openssl rand -hex 32`. |
| `CRON_SECRET` | Outro segredo aleatório, diferente do administrativo; usado como Bearer pelo agendador. |
| `ML_SELLER_ID` | Opcional; ID numérico do vendedor autorizado. Recomendado para fixar explicitamente sua conta. |
| `ML_SYNC_FROM` | Opcional; início do histórico inicial, padrão `2000-01-01T00:00:00.000Z`. Reduzir o período exclui deliberadamente registros anteriores. |

Em produção o callback deve usar HTTPS. HTTP só é aceito para `localhost`, em desenvolvimento; se o Mercado Livre não aceitar callback local, use um domínio HTTPS de desenvolvimento cadastrado. O caminho precisa ser `/api/oauth/callback`, sem query string ou fragmento. Proxies `HTTP_PROXY`/`HTTPS_PROXY`, `NO_PROXY` e certificados de confiança do Node são respeitados pelo transporte HTTP. O banco usa o transporte TCP do `pg`, independente do proxy HTTP.

## Configurar OAuth e substituir a URL provisória

1. Defina o domínio HTTPS definitivo da hospedagem. Nas configurações da sua aplicação no [Mercado Livre Developers](https://developers.mercadolivre.com.br/), substitua a URL provisória por `https://seu-dominio.com/api/oauth/callback`.
2. Defina `ML_REDIRECT_URI` com a mesma URL, incluindo protocolo, domínio, caminho e eventual barra final exatamente como registrado. Este projeto usa o caminho **sem barra final**.
3. Habilite **PKCE** na aplicação e as permissões de leitura de pós-venda/reclamações e acesso offline/renovação oferecidas pelo painel. A aplicação precisa estar habilitada para os recursos da sua conta. Não é necessário dar permissão ao serviço para aceitar devoluções ou emitir reembolsos.
4. Acesse `/` e clique em **Conectar Mercado Livre**. No diálogo HTTP Basic, use `admin` como usuário e `ADMIN_SECRET` como senha. Autorize a conta de vendedor correta no Mercado Livre.
5. O callback confirma a conexão. Consulte `/api/status` autenticado para ver vendedor, expiração, checkpoint e execuções. Ative o cron e execute uma sincronização manual para verificar a primeira importação.

O fluxo usa `state` aleatório, hash no banco, validade de dez minutos, cookie HttpOnly SameSite=Lax e `code_verifier` criptografado. O desafio é SHA-256/base64url (`S256`). O estado é consumido atomicamente uma única vez, antes da troca do código. Alterar o domínio durante um fluxo exige iniciar novamente. A primeira conta fica fixada no banco; uma tentativa posterior de conectar outro vendedor é rejeitada. `ML_SELLER_ID` pode restringir a primeira conexão também.

Os tokens são criptografados com AES-256-GCM. O token de acesso é renovado dois minutos antes de expirar, ou após um 401, e o novo refresh token é persistido antes das próximas consultas. Callback e sincronização compartilham um bloqueio PostgreSQL. Como o refresh token é de uso único, uma falha ambígua na renovação deixa `refresh_pending=true`: é necessário conectar novamente em vez de reutilizar um token possivelmente consumido. Uma falha entre receber tokens e salvá-los também exige reconexão.

## Hospedagem: Vercel + Supabase

Siga primeiro [o guia Supabase](docs/SUPABASE.md), que inclui banco privado, conexão TLS e cron no Supabase. Os passos abaixo também cobrem a alternativa de usar Vercel Cron.

1. Importe o repositório na Vercel com preset **Next.js** e Node.js 24. Use `npm ci` e `npm run build`; diretório raiz do repositório.
2. Crie ou selecione o projeto Supabase com backups e TLS. Configure `DATABASE_URL` para conexão direta ou pooling **de sessão**, respeitando o limite de conexões (`max: 5` por instância). Verifique o certificado do servidor conforme o provedor; não use `rejectUnauthorized: false`.
3. Cadastre as variáveis acima no escopo **Production**. Segredos deste ambiente de desenvolvimento não são transferidos automaticamente para a hospedagem. Use segredos e banco distintos nos previews, que não devem acessar a conta de produção.
4. Aplique `npm run db:migrate` em um terminal confiável com `DATABASE_URL` de produção, antes de ativar o serviço. Não salve a conexão em scripts versionados.
5. Faça o deploy, atualize o callback no Mercado Livre e complete o OAuth. Se a plataforma tiver proteção de deploy, permita ao callback público e ao cron alcançarem as rotas; os demais endpoints sensíveis continuam autenticados pelo serviço.
6. Por padrão, configure o job de 15 minutos pelo script `supabase/schedule.sql`, conforme o guia. **Se preferir Vercel Cron**, desative o job do Supabase, copie `deploy/vercel-cron.example.json` para `vercel.json` e faça novo deploy. Essa alternativa define `*/15 * * * *` para `GET /api/cron/sync`. A Vercel envia `Authorization: Bearer <CRON_SECRET>` quando esse segredo é configurado. Verifique a criação do cron na área de Cron Jobs do projeto.
7. Para **Vercel Cron**, use um plano que suporte execução a cada 15 minutos, como **Pro**, e confirme os limites atuais da sua conta. O Hobby não atende à frequência pelo cron nativo. O agendamento externo do Supabase não depende desse recurso. As rotas de sincronização solicitam `maxDuration=300` segundos; confirme a disponibilidade desse limite na hospedagem.
8. Verifique `/api/status` depois da primeira execução e monitore falhas/ausência de execuções. Não há envio de alertas externos neste projeto.

O agendamento precisa de um aplicativo publicado e alcançável. O cron nativo da Vercel só funciona em produção. A expressão roda nos minutos 00, 15, 30 e 45; o provedor pode atrasar ou repetir chamadas. Não use `setInterval` em funções serverless. Execuções repetidas são idempotentes; uma execução concorrente recebe `status: skipped` sem executar outra sincronização.

## Alternativa: servidor próprio e systemd

Instale Node.js 24 e PostgreSQL, configure um proxy HTTPS (Caddy/Nginx) para `127.0.0.1:3000`, copie o projeto para `/opt/ml-clickup`, instale as dependências, aplique a migração e faça o build. Crie o usuário de serviço `ml-clickup` e permita que ele leia o projeto e escreva em `.next`. O caminho de `npm` no arquivo de unidade deve corresponder à sua instalação.

Salve as variáveis em `/etc/ml-clickup.env`, legível apenas pelo administrador e pelo usuário do serviço. Não use o arquivo de exemplo com senhas de desenvolvimento em produção. Os arquivos em `deploy/` iniciam o Next.js e chamam o cron a cada quarto de hora:

```bash
sudo cp deploy/ml-clickup.service deploy/ml-clickup-sync.service deploy/ml-clickup-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ml-clickup.service ml-clickup-sync.timer
sudo systemctl list-timers ml-clickup-sync.timer
sudo journalctl -u ml-clickup-sync.service
```

O timer é persistente e o serviço `oneshot` impede sobreposição local; o bloqueio no banco protege múltiplos servidores. O `deploy/sync.sh` envia o token no header por stdin do curl, nunca na URL. Não habilite esse timer junto com o cron da Vercel ou do Supabase. Em servidor próprio a duração de uma requisição não é limitada pela configuração `maxDuration` da Vercel; ajuste o timeout do proxy e dimensione para que uma sincronização termine antes de 15 minutos. O curl do timer limita a espera a 850 segundos.

## Endpoints

| Método e rota | Autenticação | Função |
| --- | --- | --- |
| `GET /` | Pública | Instruções e início da conexão. Não exibe dados da conta. |
| `GET /api/health` | Pública | Liveness, sem consultar banco nem APIs. |
| `GET /api/oauth/start` | Admin | Inicia o fluxo OAuth com PKCE. |
| `GET /api/oauth/callback` | Estado + cookie PKCE | Recebe autorização do Mercado Livre. Não requer Basic no retorno. |
| `GET /api/status` | Admin | Estado da conexão, últimas 20 execuções e criações incertas. |
| `POST /api/sync` | Admin | Sincronização manual. |
| `GET /api/cron/sync` | `Bearer CRON_SECRET` | Sincronização agendada. |

Admin aceita HTTP Basic (`admin:ADMIN_SECRET`) e Bearer `ADMIN_SECRET`. Nunca passe segredos por query string. Para sincronizar manualmente, use um cliente HTTP confiável com `POST /api/sync` e esse header. Falhas retornam 503 com código sanitizado; uma execução concorrente retorna 200 com `skipped`.

## Busca, tarefas e prevenção de duplicatas

- A busca usa `/post-purchase/v1/claims/search`, filtrada pelo vendedor respondente e por `last_updated`. Inclui reclamações abertas e encerradas. Identifica `type=return` e reclamações com `related_entities` contendo `return`, consultando os detalhes quando necessário. O objeto da devolução vem de `/post-purchase/v2/claims/{claim_id}/returns`.
- Na primeira execução busca desde `ML_SYNC_FROM`; nas seguintes usa o checkpoint menos 15 minutos até o início da execução. Janelas com muitos resultados são subdivididas para respeitar `offset + limit < 10000`. IDs repetidos nas janelas são deduplicados. Uma janela indivisível muito densa gera erro explícito.
- Devoluções já vinculadas são consultadas novamente em cada execução, mesmo sem atualização da reclamação. O checkpoint só avança após sucesso de todas as candidatas; resultados parciais e vínculos já salvos são preservados para a próxima tentativa. Repetições de paginação mutável são compensadas pela sobreposição; a API não fornece um snapshot transacional da busca.
- Uma linha única `(seller_id, list_id, return_id)` guarda o `task_id` e um hash do conteúdo. Uma devolução inalterada não causa PUT. Mudanças atualizam o nome e a descrição da tarefa existente.
- A marca `[ml-return:SELLER_ID:RETURN_ID]` no nome/descrição permite recuperar vínculos após falha local. A busca no ClickUp percorre páginas, tarefas fechadas e arquivadas. Não remova a marca nem mova tarefas para fora da lista gerenciada.
- Antes do POST, a intenção é gravada com `creation_uncertain=true`. Se o serviço perder a resposta, morrer ou falhar ao salvar o ID, a próxima execução procura a marca e recupera o vínculo. **Se a tarefa não for encontrada, o POST não é repetido automaticamente.** A devolução fica pendente de inspeção para impedir uma criação duplicada por resposta tardia ou visibilidade eventual da API.
- Marcas duplicadas e conflitos de vínculo geram erro. Uma tarefa vinculada apagada/inacessível não é recriada automaticamente. GET/PUT têm retries limitados para rede, 429 e 5xx; POST de criação e OAuth não são repetidos automaticamente.

A API do ClickUp não fornece uma transação distribuída com o nosso banco. Por isso, a garantia prática contra duplicatas exige manter o banco, as marcas e uma única instalação usando a mesma configuração. Em casos ambíguos o serviço privilegia não duplicar, pausando aquela devolução. Não há garantia de “exactly once” fornecida pela API externa.

O nome e a descrição são gerenciados pela integração, com IDs, status, subtipo, estado do dinheiro, pedidos, itens, quantidades e envios/rastreio. Não copiamos endereço ou nome do comprador. Status nativo, responsáveis, comentários e demais campos do ClickUp não são alterados. O status do Mercado Livre aparece no nome e na descrição, evitando depender de nomes de status personalizados da lista.

## Operação e recuperação

Consulte `/api/status`. `ML_NOT_CONNECTED` pede OAuth; `ML_REAUTH_REQUIRED` pede reconexão. 403 pede verificar as permissões da aplicação/token. 429 persistente pede revisar a frequência/volume. `CLICKUP_CREATE_UNCERTAIN` indica que a criação pode ter ocorrido sem confirmação.

Para uma criação incerta, aguarde outra execução e procure a marca na lista, inclusive tarefas fechadas/arquivadas. Se a tarefa aparecer, a reconciliação é automática. Se tiver sido movida, restaure sua presença na lista e preserve a marca. Não apague a linha do banco enquanto houver dúvida.

**Somente após confirmar no ClickUp que nenhuma tarefa foi criada**, e com o agendamento temporariamente desativado e nenhuma execução ativa, um operador pode remover a intenção pendente para permitir nova criação. Use parâmetros da linha indicada por `/api/status`; o comando abaixo é um modelo de consulta parametrizada, não um comando para colar no psql literalmente:

```sql
DELETE FROM ml_integration.return_tasks
WHERE seller_id = $1 AND list_id = $2 AND return_id = $3
  AND task_id IS NULL AND creation_uncertain = true;
```

Reconectar a mesma conta preserva vínculos e checkpoint. Trocar de conta é uma migração operacional deliberada: desative o cron, faça backup e trate `ml_account` e os vínculos antes de reconectar. Não há endpoint público para apagar dados ou redefinir vínculos.

Faça backup do banco **e da chave de criptografia**; perder a chave exige reconexão. Rotacionar a chave sem recriptografar os registros torna tokens e estados existentes ilegíveis. Rotacione `ADMIN_SECRET`/`CRON_SECRET` também no agendador. Desative logs de query string no callback no proxy/APM, pois o retorno OAuth contém `code` e `state`. O código registra apenas códigos de erro sanitizados, sem corpo de respostas ou tokens.

Uma execução interrompida pelo provedor pode permanecer `running` em `sync_runs`; a próxima execução é permitida quando a conexão PostgreSQL anterior encerrar e liberar o bloqueio. Investigue o timeout e o encerramento da sessão antes de forçar qualquer ação. O endpoint de saúde é apenas liveness; monitoramento funcional deve verificar execuções recentes em `/api/status`.

O trabalho é sequencial e o histórico/volume podem ultrapassar 300 segundos em contas grandes. Nesse caso use servidor próprio e, se necessário, uma fila/worker como evolução; não aumente a frequência para compensar um backfill lento. Ajustar `ML_SYNC_FROM` reduz o backfill, mas muda explicitamente a cobertura histórica. Há reconciliação periódica de todas as devoluções já conhecidas; avalie retenção/arquivamento do banco conforme seu volume.

## Testes e validação

```bash
npm run typecheck
npm test
npm run build
# Teste opcional de PostgreSQL real: use SOMENTE banco de teste terminado em _test.
TEST_DATABASE_URL=postgresql://postgres:senha@localhost:5432/ml_clickup_test npm test
```

Os testes padrão usam PostgreSQL WASM (PGlite) para executar o SQL real sem depender de um banco externo e mocks das APIs. Também verificam migração para schema privado, preservação dos dados, restrições das roles de API do Supabase e configuração TLS/pooler. Cobrem PKCE, estado/cookie/expiração/replay, criptografia, restrição de vendedor, renovação e falha ambígua de tokens, 401/429, paginação, subdivisão de janelas, autenticação das rotas, criação/atualização idempotente, recuperação de falha no commit, criação incerta e checkpoint. O teste adicional executa as migrações, constraints e bloqueio de sessão em PostgreSQL real. A CI provisiona esse banco automaticamente. Nenhum teste precisa dos seus tokens de produção.

## Referências oficiais

- [Autenticação, PKCE e renovação do Mercado Livre](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao?nocache=true)
- [Reclamações: filtros e paginação](https://developers.mercadolivre.com.br/pt_br/atributos/gerenciar-reclamacoes)
- [Devoluções e seus estados](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento/gerenciar-devolucoes)
- [ClickUp: listar tarefas](https://developer.clickup.com/reference/gettasks), [criar](https://developer.clickup.com/reference/createtask), [atualizar](https://developer.clickup.com/reference/updatetask)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs), [limites](https://vercel.com/docs/cron-jobs/usage-and-pricing) e [autenticação](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
