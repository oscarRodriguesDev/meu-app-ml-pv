# Supabase por HTTPS: configurar as quatro chaves

O aplicativo usa os nomes abaixo, conforme o painel de configuração:

```dotenv
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_JWKS_URL=https://SEU_PROJETO.supabase.co/auth/v1/.well-known/jwks.json
```

A conexão de produção utiliza **URL + chave secreta**, via HTTPS/443. Não usa senha do PostgreSQL, `DATABASE_URL`, pooler ou Prisma. As chamadas vão para `/rest/v1/rpc/ml_service`, com a chave secreta no header `apikey`. Chaves novas `sb_secret_…` não são JWTs e não são colocadas em `Authorization: Bearer`. A chave legada `service_role` também é aceita.

A chave publicável é opcional e não acessa os dados da integração. A URL JWKS também é opcional, derivada do projeto quando ausente, e fica reservada para validação de JWTs caso Supabase Auth seja adotado no futuro. O serviço atual usa `ADMIN_SECRET` para administração, `CRON_SECRET` para o agendador e OAuth do Mercado Livre. Não há login do Supabase Auth nem uso artificial de JWKS.

## 1. Instalar a estrutura, uma vez

No projeto Supabase, abra **SQL Editor**, cole e execute todo o conteúdo de [supabase/install.sql](../supabase/install.sql) como proprietário do banco. O arquivo é transacional e pode ser reaplicado: verifica as versões e preserva dados existentes. Ele aplica as migrações 001, 002 e 003, incluindo a função RPC.

As chaves da API não permitem criar essa estrutura pelo endpoint REST; portanto, essa instalação inicial precisa do SQL Editor (ou do comando opcional `db:migrate` para operadores que já tenham conexão PostgreSQL). Não há uma RPC de SQL arbitrário no serviço.

As seis tabelas ficam no schema privado `ml_integration`, com RLS habilitada e acesso direto revogado às roles da API. A única entrada é `public.ml_service`, com operações fixas e `EXECUTE` somente para `service_role`, a role autorizada pela chave secreta. Não adicione `ml_integration` aos schemas expostos pela Data API e não libere a função para `anon` ou `authenticated`.

Verifique no SQL Editor:

```sql
SELECT version FROM ml_integration.schema_migrations ORDER BY version;
-- 001, 002, 003

SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='ml_integration';
-- Seis tabelas com RLS habilitada.
```

Mantenha a **Data API habilitada**, com o schema `public` exposto para alcançar a RPC. O instalador notifica a recarga de cache do PostgREST.

Ao atualizar uma instalação antiga, desative o cron, execute o instalador e publique o código HTTPS antes de reativar. O bloqueio anterior por sessão PostgreSQL e o novo bloqueio persistente não devem operar simultaneamente.

## 2. Configurar os ambientes

Cadastre as quatro variáveis no ambiente que executa o Next.js. Mantenha `SUPABASE_SECRET_KEY` como segredo exclusivo do servidor, sem prefixo `NEXT_PUBLIC_` e sem enviá-la ao navegador. Não copie valores reais para o GitHub ou para o chat.

Configure também as credenciais ML/ClickUp e `TOKEN_ENCRYPTION_KEY`, `ADMIN_SECRET`, `CRON_SECRET`, `ML_REDIRECT_URI`, conforme `.env.example`. Para desenvolvimento, `.env.local` é ignorado pelo Git. Para produção, use as variáveis Production da hospedagem. Valores salvos em um ambiente não são copiados automaticamente para outro.

Em ambientes com rede restrita, autorize o **domínio HTTPS do projeto Supabase**, como `SEU_PROJETO.supabase.co`, além das APIs Mercado Livre/ClickUp. Não é necessário acesso TCP ao host `db.…supabase.co` nem à porta 5432. Vincule a chave secreta ao destino HTTPS do projeto quando a plataforma usar regras de injeção de credenciais.

Para verificar somente Supabase e instalação SQL, sem depender do OAuth já conectado:

```bash
npm ci
npm run supabase:check
```

O resultado esperado é `supabase: connected` e `schema: ready`; `mercadoLivreConnected` pode ser false antes do OAuth. O comando não imprime chaves ou tokens. Um 404 pede conferir a instalação da função e a recarga de cache. Um 401/403 pede conferir a chave secreta e as permissões da API.

## 3. Hospedar e autorizar Mercado Livre

Importe o repositório na Vercel com preset Next.js, Node.js 24 e build `npm run build`, ou use um servidor Node.js. O Supabase guarda os dados e executa o cron; não hospeda o servidor Next.js neste projeto.

Depois do deploy, defina o domínio definitivo:

- Início da autorização: `https://SEU_DOMINIO/api/oauth/start`
- Redirect URI: `https://SEU_DOMINIO/api/oauth/callback`

Substitua a URL provisória no painel Mercado Livre e configure a mesma em `ML_REDIRECT_URI`. Habilite PKCE e complete a autorização pelo navegador com usuário administrativo `admin` e senha `ADMIN_SECRET`. O callback é do Next.js, não `/auth/v1/callback` do Supabase. A URL completa de autorização é gerada a cada tentativa com estado e PKCE novos.

Verifique `/api/status` autenticado e execute `POST /api/sync` com Bearer `ADMIN_SECRET`. Não coloque segredos na URL.

## Diagnosticar falha antes de abrir o Mercado Livre

Se `/api/oauth/start` retornar `OAUTH_START_FAILED`, o erro ocorreu na preparação do fluxo no Next.js. O início do fluxo não exige que ClickUp e cron já estejam configurados. O endpoint retorna `cause`, `action` e, para configurações inválidas, `issues` com **nomes** de variáveis e `missing`/`invalid`; os valores não são retornados. Os logs da Vercel registram o mesmo diagnóstico pelo evento `oauth_start_failed`, sem segredos ou corpo de erros externos.

Confira as variáveis na Vercel em **Settings → Environment Variables → Production** e faça novo deploy após corrigi-las. Configurar variáveis no Codex ou no Supabase não as configura na Vercel.

- `CONFIG_OAUTH_INVALID`: verifique os campos indicados em `issues`. `ADMIN_SECRET` precisa de pelo menos 32 caracteres; `TOKEN_ENCRYPTION_KEY` deve ser uma chave de 32 bytes em base64 (`openssl rand -base64 32`). ML client ID, client secret e redirect URI também são necessários.
- `CONFIG_REDIRECT_URI_INVALID`: use o caminho exato `/api/oauth/callback`, sem query ou fragmento. Para o domínio publicado nesta instalação: `https://meu-app-ml-pv-rosy.vercel.app/api/oauth/callback`.
- `CONFIG_SUPABASE_INVALID`: verifique a URL do projeto e a chave secreta indicadas. A chave publicável não pode substituir `SUPABASE_SECRET_KEY`.
- `SUPABASE_HTTP_401` / `SUPABASE_HTTP_403`: confira a chave de servidor e a permissão `service_role` da função RPC.
- `SUPABASE_HTTP_404`: confira o projeto selecionado, Data API habilitada e instalação de `supabase/install.sql`.
- `SUPABASE_NETWORK_ERROR`: confira o domínio e a conectividade HTTPS com o Supabase.

Com a configuração válida, o endpoint pede HTTP Basic (`admin` e `ADMIN_SECRET`) e só depois grava o estado OAuth e redireciona ao Mercado Livre. A autorização e a troca do código ainda exigem que o callback esteja cadastrado na aplicação Mercado Livre.

## Diagnosticar `ML_HTTP_400` após a conexão

Esse código significa que o Mercado Livre recusou uma consulta HTTP com status 400. O código isolado não revela qual consulta ou parâmetro foi rejeitado. A sincronização agora preserva essa informação mesmo quando a falha ocorre em uma devolução individual.

Acesse [o diagnóstico do aplicativo publicado](https://meu-app-ml-pv-rosy.vercel.app/api/diagnostics/ml), usando usuário `admin` e `ADMIN_SECRET` como senha. São feitas até seis consultas de leitura, sem criar tarefas nem avançar o checkpoint:

1. `account_identity`: valida a identidade do token sem retornar o perfil.
2. `seller_filter`: somente vendedor respondente e paginação mínima.
3. `seller_opened` e `seller_closed`: adicionam cada estado separadamente.
4. `date_range`: adiciona o mesmo intervalo usado na sincronização.
5. `sort_and_page`: usa os parâmetros completos, incluindo ordenação e tamanho de página.

A resposta informa `ok` ou o código de erro de cada verificação. Primeiro `account_identity` confirma que o token pertence ao vendedor salvo. Também são testados `seller_opened` e `seller_closed`, mantendo o vendedor como filtro. Em HTTP 400, copie também `validationMessage` da resposta autenticada: ela contém o texto de validação limitado e com dados sensíveis ocultos, sem entrar nos logs. Os logs `sync_failed` passam a indicar `operation` e, quando reconhecida, uma categoria fixa `reason`, sem copiar mensagens brutas ou IDs do Mercado Livre. O formato das datas foi alinhado aos exemplos documentados: milissegundos e offset explícito (`.000+00:00`), com o `+` codificado na URL. O período e os filtros não são reduzidos automaticamente para contornar erros.

Se todas as verificações passarem, tente a sincronização novamente e consulte a operação de qualquer falha posterior (`claim_detail` ou `claim_returns`). Não ative o agendamento antes de confirmar a primeira sincronização bem-sucedida.

## 4. Cron de 15 minutos pelo Supabase

Após instalar a estrutura, publicar o Next.js e conectar o vendedor:

1. Habilite **Cron (`pg_cron`)**, **`pg_net`** e **Vault** nas extensões/integrações do Supabase.
2. No Vault, crie `ml_clickup_app_url` com a origem HTTPS do aplicativo (sem caminho) e `ml_clickup_cron_secret` com o mesmo valor de `CRON_SECRET` no Next.js.
3. Execute [supabase/schedule.sql](../supabase/schedule.sql) no SQL Editor. O script valida os valores e agenda `ml-clickup-sync`, com `*/15 * * * *`. Reaplicar atualiza o mesmo job.
4. Confirme que o endpoint pode ser alcançado por HTTPS a partir do Supabase. Se houver proteção de deploy, configure o acesso do cron; o endpoint ainda verifica seu Bearer.

O job usa `net.http_get` com Bearer e timeout de 300 segundos. O domínio e segredo são lidos do Vault a cada execução; o comando do job não contém valores secretos. O `vercel.json` padrão não cria outro cron. Não habilite o timer systemd ou Vercel Cron simultaneamente. O limite da função na hospedagem continua valendo, mesmo com agendador externo.

Verificação:

```sql
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname='ml-clickup-sync';
SELECT jobid,status,start_time,end_time FROM cron.job_run_details
WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='ml-clickup-sync')
ORDER BY start_time DESC LIMIT 10;
SELECT id,status_code,timed_out,error_msg,created FROM net._http_response ORDER BY created DESC LIMIT 10;
```

Sucesso no histórico do cron confirma o envio à fila, não o sucesso da sincronização. Confira a resposta HTTP e `/api/status`: 200 para sucesso/skipped, 401 para segredo incorreto, 503 para falha. Monitore ausência de execuções e projetos Supabase pausados. Planeje retenção de `cron.job_run_details`; respostas HTTP são temporárias.

Para remover o cron:

```sql
SELECT cron.unschedule('ml-clickup-sync');
```

Para usar Vercel Cron, desative esse job, copie `deploy/vercel-cron.example.json` para `vercel.json` e faça deploy em um plano que comporte 15 minutos. Para servidor próprio, use os arquivos systemd em `deploy/`.

## Bloqueio e recuperação

A RPC mantém um bloqueio com UUID de proprietário e validade de 120 segundos. Há renovação a cada 20 segundos e antes das mutações externas. As operações protegidas conferem o proprietário e a validade dentro da mesma transação da gravação. Se o processo morrer ou perder a conexão, uma execução seguinte pode adquirir o bloqueio após expirar; a execução antiga não pode salvar dados posteriormente.

Isso preserva a serialização da renovação de tokens e da sincronização por HTTPS, sem depender de sessão PostgreSQL. O bloqueio não transforma ClickUp e Supabase em uma transação distribuída: a intenção de criação é gravada antes do POST e uma criação ambígua é reconciliada pela marca, sem repetir automaticamente o POST. Veja os procedimentos operacionais no README.

## Referências oficiais

- [Chaves API e seu uso em headers](https://supabase.com/docs/guides/getting-started/api-keys)
- [Funções SQL, permissões e search_path](https://supabase.com/docs/guides/database/functions)
- [Cron](https://supabase.com/docs/guides/cron/quickstart)
- [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Agendamento com Vault](https://supabase.com/docs/guides/functions/schedule-functions)
