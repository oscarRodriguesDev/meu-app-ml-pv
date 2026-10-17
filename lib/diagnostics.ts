import { ConfigurationError } from "./config";
import { ApiError } from "./http";

/** Only controlled codes and variable names may enter responses/logs. Never include upstream bodies or values. */
export function oauthStartDiagnostic(error: unknown) {
  if (error instanceof ConfigurationError) {
    return {
      cause: error.code,
      issues: error.issues,
      action: "Corrija as variáveis indicadas na Vercel, no ambiente Production, e faça um novo deploy. missing = ausente; invalid = valor ou formato inválido.",
    };
  }
  let cause = "OAUTH_START_INTERNAL_ERROR";
  if (error instanceof ApiError && error.service === "SUPABASE") cause = error.message;
  else if (error instanceof Error && /^(SUPABASE|OAUTH)_[A-Z0-9_]+$/.test(error.message)) cause = error.message;
  const action = cause === "SUPABASE_HTTP_404"
    ? "Confira se SUPABASE_URL aponta ao projeto correto, se a Data API está habilitada e se supabase/install.sql foi aplicado."
    : ["SUPABASE_HTTP_401", "SUPABASE_HTTP_403"].includes(cause)
      ? "Confira SUPABASE_SECRET_KEY na Vercel e a permissão service_role para executar public.ml_service."
      : cause === "SUPABASE_NETWORK_ERROR"
        ? "Confira o domínio SUPABASE_URL e a conectividade HTTPS da hospedagem com o Supabase."
        : "Consulte os logs da Vercel pelo evento oauth_start_failed. Não compartilhe senhas, chaves ou tokens.";
  return { cause, action };
}

export function syncFailureDiagnostic(error: unknown) {
  if (error instanceof ConfigurationError) {
    return { issues: error.issues, action: "Corrija as variáveis indicadas na Vercel em Production e publique um novo deploy." };
  }
  if (!(error instanceof ApiError) || error.service !== "ML") return {};
  const details = error.details ?? { operation: "mercado_api" as const };
  const action = error.status === 400
    ? "Abra /api/diagnostics/ml com a autenticação administrativa para verificar os filtros da busca. Consulte operation e reason no log sync_failed."
    : error.status === 403
      ? "Confira as permissões de pós-venda/reclamações da aplicação Mercado Livre."
      : "Confira o diagnóstico da consulta ao Mercado Livre no log sync_failed.";
  return { ...details, action };
}
