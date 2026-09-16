import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGoogleCredentials, saveGoogleCredentials } from "@/lib/credentials";
import { verifyGoogle } from "@/lib/google";

/**
 * Fluxo OAuth num arquivo só: sem `code` na URL começa (redireciona ao
 * consentimento do Google); com `code` termina (troca por refresh token,
 * valida, grava e volta para a home).
 *
 * Exige Client ID e Secret já salvos — é o que /api/settings/google grava no
 * primeiro passo. `access_type=offline` + `prompt=consent` é o que faz o Google
 * devolver refresh token; sem `prompt=consent` ele só vem na primeira
 * autorização da vida daquele client.
 *
 * O resultado volta em `/?google=…` porque a tela de configuração é um
 * `<dialog>` dentro da home; ela lê o parâmetro e mostra.
 */
const STATE_COOKIE = "google-oauth-state";
const SCOPE = "https://www.googleapis.com/auth/adwords";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectUri = `${url.origin}${url.pathname}`;
  const jar = await cookies();
  const creds = await getGoogleCredentials();
  const back = (message: string) =>
    NextResponse.redirect(new URL(`/?google=${encodeURIComponent(message)}`, url.origin));

  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error");

  if (!code && !denied) {
    if (!creds.clientId || !creds.clientSecret) {
      return back("Salve Client ID e Client Secret antes de autorizar.");
    }
    const state = randomBytes(16).toString("hex");
    jar.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    consent.search = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();
    return NextResponse.redirect(consent);
  }

  if (denied) return back(`O Google recusou a autorização (${denied}).`);

  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!expected || expected !== url.searchParams.get("state")) {
    return back("A autorização não bateu com este navegador (state). Tente de novo.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code!,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const token = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !token.refresh_token) {
    return back(
      token.error === "redirect_uri_mismatch"
        ? `O client OAuth não tem este URI de redirecionamento cadastrado: ${redirectUri}`
        : token.refresh_token === undefined && res.ok
          ? "O Google não devolveu refresh token. Revogue o acesso deste app em myaccount.google.com/permissions e autorize de novo."
          : (token.error_description ?? token.error ?? `O Google respondeu ${res.status}.`),
    );
  }

  const check = await verifyGoogle({ ...creds, refreshToken: token.refresh_token });
  if (!check.ok) return back(check.message);

  try {
    await saveGoogleCredentials({
      developerToken: creds.developerToken,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      apiVersion: creds.apiVersion,
      refreshToken: token.refresh_token,
      loginCustomerId: check.loginCustomerId,
      accounts: check.accounts,
    });
  } catch {
    return back(
      "Autorizou, mas não há onde gravar: defina SETTINGS_SECRET nas variáveis de ambiente.",
    );
  }

  return back("ok");
}
