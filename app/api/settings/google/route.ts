import { NextResponse } from "next/server";
import {
  clearGoogleCredentials,
  DEFAULT_GOOGLE_API_VERSION,
  envHasGoogle,
  getGoogleCredentials,
  mask,
  saveGoogleCredentials,
  type StoredAccount,
} from "@/lib/credentials";
import { verifyGoogle } from "@/lib/google";

/**
 * Espelho de /api/settings para o Google Ads. Mesmas regras: o que a tela
 * salva vence o ambiente, o GET só devolve máscara, campo em branco mantém o
 * valor vigente.
 *
 * Diferença: a credencial se completa em dois passos. Client ID, secret e
 * developer token são salvos primeiro; o refresh token vem colado ou pelo
 * fluxo OAuth em /api/settings/google/oauth, que só funciona com o client já
 * gravado.
 */
export const NOWHERE_TO_SAVE =
  "Este servidor não grava arquivos e não tem segredo para cifrar o cookie. Defina SETTINGS_SECRET (qualquer texto longo e aleatório) nas variáveis de ambiente do serviço.";

export const REDIRECT_PATH = "/api/settings/google/oauth";

export async function GET(request: Request) {
  const c = await getGoogleCredentials();
  return NextResponse.json({
    configured: Boolean(c.refreshToken && c.clientId && c.clientSecret && c.developerToken),
    // O client está salvo mas ainda falta autorizar no Google.
    needsAuth: Boolean(c.clientId && c.clientSecret && !c.refreshToken),
    // Client ID não é segredo (vai na URL de consentimento); ver inteiro ajuda a conferir.
    clientId: c.clientId,
    clientSecretMask: mask(c.clientSecret),
    developerTokenMask: mask(c.developerToken),
    refreshTokenMask: mask(c.refreshToken),
    loginCustomerId: c.loginCustomerId,
    apiVersion: c.apiVersion,
    accounts: c.accounts,
    fromEnv: c.fromEnv,
    envHasGoogle: envHasGoogle(),
    defaultApiVersion: DEFAULT_GOOGLE_API_VERSION,
    // O que precisa estar cadastrado no client OAuth do Google Cloud.
    redirectUri: new URL(REDIRECT_PATH, request.url).toString(),
  });
}

const digits = (v: string) => v.replace(/[\s-]/g, "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    developerToken?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    loginCustomerId?: string;
    apiVersion?: string;
    accounts?: StoredAccount[];
  };

  const current = await getGoogleCredentials();
  const developerToken = body.developerToken?.trim() || current.developerToken;
  const clientId = body.clientId?.trim() || current.clientId;
  const clientSecret = body.clientSecret?.trim() || current.clientSecret;
  const refreshToken = body.refreshToken?.trim() || current.refreshToken;
  const loginCustomerId = digits(body.loginCustomerId ?? current.loginCustomerId);
  const apiVersion = body.apiVersion?.trim() || current.apiVersion;

  if (!developerToken || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Preencha developer token, Client ID e Client Secret." },
      { status: 400 },
    );
  }
  if (!/^v\d+$/.test(apiVersion)) {
    return NextResponse.json(
      { error: "Versão da API deve ter o formato vNN, como v25." },
      { status: 400 },
    );
  }
  if (loginCustomerId && !/^\d{10}$/.test(loginCustomerId)) {
    return NextResponse.json(
      { error: "O ID da conta de administrador tem 10 dígitos (com ou sem traços)." },
      { status: 400 },
    );
  }

  const partial = { developerToken, clientId, clientSecret, refreshToken, loginCustomerId, apiVersion };

  // Sem refresh token ainda não há o que verificar: grava o client para o
  // fluxo OAuth conseguir começar.
  if (!refreshToken) {
    try {
      await saveGoogleCredentials({ ...partial, accounts: [] });
    } catch {
      return NextResponse.json({ error: NOWHERE_TO_SAVE }, { status: 501 });
    }
    return NextResponse.json({ ok: true, needsAuth: true });
  }

  const check = await verifyGoogle(partial);
  if (!check.ok) {
    return NextResponse.json({ error: check.message, code: check.code }, { status: 400 });
  }

  // Contas escolhidas na tela vencem; senão ficam as que a credencial revelou.
  const chosen = body.accounts
    ?.map((a) => ({ id: digits(a.id ?? ""), name: a.name }))
    .filter((a) => /^\d{10}$/.test(a.id));
  const accounts = chosen?.length ? chosen : check.accounts;

  if (!accounts.length) {
    return NextResponse.json(
      {
        error:
          "A credencial é válida, mas nenhuma conta de anúncios apareceu. Confira se o usuário que autorizou tem acesso às contas — ou informe o ID da MCC em 'Conta de administrador'.",
      },
      { status: 400 },
    );
  }

  try {
    await saveGoogleCredentials({
      ...partial,
      loginCustomerId: check.loginCustomerId,
      accounts,
    });
  } catch {
    return NextResponse.json({ error: NOWHERE_TO_SAVE }, { status: 501 });
  }

  return NextResponse.json({ ok: true, accounts });
}

/** Apaga o que a tela salvou; o painel volta a usar as variáveis de ambiente. */
export async function DELETE() {
  await clearGoogleCredentials();
  return NextResponse.json({ ok: true });
}
