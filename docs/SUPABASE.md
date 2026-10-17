# Configurar Supabase e hospedar o Next.js

O Supabase fornece o PostgreSQL e pode executar o agendamento a cada 15 minutos. O aplicativo Next.js continua hospedado na Vercel ou em um servidor Node.js. Não é necessário usar Supabase Auth, `@supabase/supabase-js`, chave `anon` ou `service_role`.

## 1. Criar ou selecionar o projeto

No [painel Supabase](https://supabase.com/dashboard), escolha seu projeto (ou crie um na região próxima à hospedagem), anote a referência do projeto e guarde a senha do banco no gerenciador de segredos. Não publique essa senha no chat nem no GitHub.

Abra **Connect → Session pooler** e copie a conexão PostgreSQL da **porta 5432**, semelhante a:

```text
postgresql://postgres.PROJECT_REF:SENHA_CODIFICADA@aws-0-REGIAO.pooler.supabase.com:5432/postgres
```

Use exatamente o host e o usuário fornecidos pelo painel. Codifique caracteres reservados da senha na URL, ou use a string pronta fornecida pelo Supabase. Não use a conexão Transaction (porta 6543): o serviço depende de bloqueios de sessão. O código rejeita essa porta nos hosts do Supabase. Uma conexão direta ao banco também funciona se a rede da hospedagem suportar o endereço fornecido.

Defina essa conexão em `DATABASE_URL`, tanto no ambiente que aplicará as migrações quanto na hospedagem Next.js. Essa variável nunca usa o prefixo `NEXT_PUBLIC_`. Não confunda a URL PostgreSQL com `https://PROJECT_REF.supabase.co`, que é a URL da API do projeto e não é necessária ao aplicativo.

## 2. Certificado e acesso de rede

As conexões ao Supabase verificam o certificado TLS e o hostname. Em **Database Settings / SSL configuration**, baixe o certificado CA do banco, caso necessário, e defina seu conteúdo PEM em `DATABASE_SSL_CA`. Essa variável aceita PEM multilinha ou `\n` literais. Não acrescente parâmetros `sslrootcert`, `sslcert` ou `sslkey` à URL quando usar essa variável.

Se não for necessário um CA específico no endpoint escolhido, a verificação usa as autoridades de confiança do Node.js. Não desabilite a validação TLS para resolver erros de certificado.

Caso existam restrições de rede no Supabase, autorize o IP de saída do ambiente/hospedagem. Para aplicar migrações neste ambiente em nuvem, o host de conexão do Supabase também precisa ser permitido no acesso **TCP à porta 5432**; a lista de domínios HTTP não libera PostgreSQL. Não é preciso tornar o banco público sem restrições.

## 3. Aplicar as tabelas

No terminal do projeto com `DATABASE_URL` e, se necessário, `DATABASE_SSL_CA` disponíveis:

```bash
npm ci
npm run db:migrate
```

Também é possível executar `db/001_init.sql` e depois `db/002_private_schema.sql` no SQL Editor do Supabase, dentro de uma única transação (`BEGIN;` antes dos dois conteúdos e `COMMIT;` depois). O comando npm é preferível porque controla a ordem, verifica versões já aplicadas e usa um bloqueio de migração. Não reaplique a migração 001 manualmente se a 002 já tiver sido aplicada.

A migração 002 move os dados existentes de uma instalação anterior de `public` para **`ml_integration`**, sem apagar tokens ou vínculos. Todas as consultas do aplicativo usam explicitamente esse schema. O schema não deve ser adicionado aos schemas expostos pela Data API.

As tabelas têm RLS habilitada, sem políticas para os clientes da API. O acesso de `PUBLIC`, `anon`, `authenticated` e `service_role` ao schema/tabelas é revogado. O aplicativo usa a conexão PostgreSQL do proprietário das tabelas (o usuário fornecido pelo painel), pelo backend. Não crie uma política pública para corrigir um problema de conexão.

No SQL Editor, verifique:

```sql
SELECT version FROM ml_integration.schema_migrations ORDER BY version;
-- Deve retornar 001 e 002.

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'ml_integration';
-- Cinco tabelas, todas com rowsecurity = true.
```

## 4. Publicar o aplicativo Next.js

Importe [oscarRodriguesDev/meu-app-ml-pv](https://github.com/oscarRodriguesDev/meu-app-ml-pv) na Vercel, usando Node.js 24 e o preset Next.js. Configure as variáveis de `.env.example` no ambiente **Production**. `DATABASE_URL` aponta para o Supabase. Os tokens já existentes neste ambiente não são copiados automaticamente para a Vercel.

Além das credenciais de API, configure `TOKEN_ENCRYPTION_KEY`, `ADMIN_SECRET`, `CRON_SECRET` e `ML_REDIRECT_URI`. Gere segredos distintos com os comandos indicados no README. Faça o build com `npm run build`. O `vercel.json` padrão não cria cron na Vercel: usaremos o Supabase como agendador, inclusive se o plano da Vercel não permitir cron a cada 15 minutos. Confirme o limite de duração das funções no seu plano; o endpoint solicita até 300 segundos. Executar o cron fora da Vercel não aumenta esse limite.

Depois do deploy, use seu domínio definitivo para:

- **Iniciar autorização:** `https://SEU_DOMINIO/api/oauth/start`
- **Redirect URI no Mercado Livre:** `https://SEU_DOMINIO/api/oauth/callback`

Cadastre o callback no painel Mercado Livre e em `ML_REDIRECT_URI`, habilite PKCE e complete a autorização pelo navegador. Esse callback é do **Next.js**, não do Supabase Auth. Não use `https://PROJECT_REF.supabase.co/auth/v1/callback`.

## 5. Ativar o cron no Supabase

Somente depois de publicar, aplicar as migrações e conectar o Mercado Livre:

1. Habilite **Cron (`pg_cron`)**, **`pg_net`** e **Vault** no painel de extensões/integrações do Supabase.
2. No **Vault**, crie dois segredos com nomes exatos:
   - `ml_clickup_app_url`: origem HTTPS do aplicativo, por exemplo `https://meu-app.vercel.app`, sem caminho.
   - `ml_clickup_cron_secret`: o mesmo valor de `CRON_SECRET` configurado no Next.js.
3. Execute o conteúdo de `supabase/schedule.sql` no SQL Editor como proprietário do banco. O script valida as configurações antes de agendar. O job `ml-clickup-sync` executa `*/15 * * * *`, enviando `Authorization: Bearer …` para `/api/cron/sync`. Reexecutar o script atualiza o mesmo job.
4. Não habilite simultaneamente o cron da Vercel ou o timer systemd. Se houver proteção de acesso ao deploy, o Supabase precisa conseguir atingir esse endpoint; o serviço ainda verifica `CRON_SECRET`.

A URL e o segredo são lidos do Vault em cada execução. Ao trocar domínio ou rotacionar o segredo, atualize o Vault e a variável correspondente na hospedagem. Não grave o token como texto dentro do comando do job nem como parâmetro de URL.

Para confirmar o agendamento:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job WHERE jobname='ml-clickup-sync';

SELECT jobid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='ml-clickup-sync')
ORDER BY start_time DESC LIMIT 10;

SELECT id, status_code, timed_out, error_msg, created
FROM net._http_response ORDER BY created DESC LIMIT 10;
```

O sucesso de `cron.job_run_details` confirma o envio para a fila HTTP, não o sucesso da sincronização. Verifique também a resposta HTTP e `/api/status` autenticado. O endpoint retorna 200 para sucesso/execução já em andamento, 401 para segredo incorreto e 503 para falhas. A resposta deve chegar dentro do limite da função e do timeout HTTP de 300 segundos.

O Supabase retém respostas HTTP por tempo limitado. Monitore falhas e dimensione o plano/banco para permanecer ativo: um projeto pausado não executará o cron. O histórico `cron.job_run_details` pode precisar de retenção própria conforme o volume.

Para desativar:

```sql
SELECT cron.unschedule('ml-clickup-sync');
```

## Alternativas de agendamento

Para usar Vercel Cron em vez do Supabase, copie `deploy/vercel-cron.example.json` para `vercel.json`, faça novo deploy em um plano que permita 15 minutos e desative o job no Supabase. Para servidor próprio, use os arquivos systemd de `deploy/`. Escolha apenas um agendador.

## Referências

- [Conexões PostgreSQL e poolers](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Schemas e dados](https://supabase.com/docs/guides/database/tables)
- [Cron](https://supabase.com/docs/guides/cron/quickstart)
- [HTTP assíncrono com pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Agendamento com segredos no Vault](https://supabase.com/docs/guides/functions/schedule-functions)
