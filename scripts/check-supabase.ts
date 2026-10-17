import { database } from "../lib/db";
try {
  const result=await database().call<{connected:boolean}>("status_get",{list_id:process.env.CLICKUP_LIST_ID??"901717874275"});
  console.log(JSON.stringify({supabase:"connected",schema:"ready",mercadoLivreConnected:result.connected}));
} catch(error) {
  const message=error instanceof Error?error.message:"";
  const code=/^(SUPABASE|CONFIG)_[A-Z0-9_]+$/.test(message)?message:"SUPABASE_CHECK_FAILED";
  console.error(JSON.stringify({error:code,action:code==="SUPABASE_HTTP_404"?"Execute supabase/install.sql no SQL Editor.":"Confira as variáveis, o domínio HTTPS permitido e a instalação SQL."}));
  process.exitCode=1;
}
