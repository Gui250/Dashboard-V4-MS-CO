import { NextResponse } from "next/server";
import {
  clearCredentials,
  DEFAULT_API_VERSION,
  envHasToken,
  getCredentials,
  mask,
  saveCredentials,
  type StoredAccount,
} from "@/lib/credentials";
import { verifyToken } from "@/lib/meta";

/**
 * O que a tela salva vence o ambiente. Um `META_ACCESS_TOKEN` que a Meta
 * bloqueou deixava o painel sem saída: a tela travava e só um redeploy trocava
 * o token. Agora a tela grava em arquivo e, onde o disco é somente leitura
 * (Vercel), num cookie httpOnly cifrado — só aquele navegador passa a usá-lo.
 *
 * Não há portão por endereço de origem. Já houve, e ele bloqueava o dono na
 * própria máquina enquanto protegia pouco: o `GET` só devolve `mask()`, então o
 * formulário não vaza o token. A exposição que importa num deploy é outra: o
 * painel inteiro não tem autenticação.
 */
const NOWHERE_TO_SAVE =
  "Este servidor não grava arquivos e não tem segredo para cifrar o cookie. Defina SETTINGS_SECRET (qualquer texto longo e aleatório) nas variáveis de ambiente do serviço.";

/** Estado atual, sempre mascarado — o token cheio nunca volta ao browser. */
export async function GET() {
  const credentials = await getCredentials();
  return NextResponse.json({
    configured: Boolean(credentials.accessToken),
    accessTokenMask: mask(credentials.accessToken),
    appSecretMask: mask(credentials.appSecret),
    apiVersion: credentials.apiVersion,
    accounts: credentials.accounts,
    fromEnv: credentials.fromEnv,
    envHasToken: envHasToken(),
    defaultApiVersion: DEFAULT_API_VERSION,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    accessToken?: string;
    appSecret?: string;
    apiVersion?: string;
    accounts?: StoredAccount[];
  };

  const current = await getCredentials();
  // Token em branco no formulário significa "mantém o que já está valendo",
  // porque a tela nunca recebeu o valor cheio para devolver.
  const accessToken = body.accessToken?.trim() || current.accessToken;
  const appSecret = (body.appSecret ?? current.appSecret).trim();
  const apiVersion = body.apiVersion?.trim() || current.apiVersion;

  if (!accessToken) {
    return NextResponse.json({ error: "Cole o token de acesso." }, { status: 400 });
  }
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    return NextResponse.json(
      { error: "Versão da API deve ter o formato vNN.N, como v26.0." },
      { status: 400 },
    );
  }

  const check = await verifyToken(accessToken, appSecret, apiVersion);
  if (!check.ok) {
    return NextResponse.json({ error: check.message, code: check.code }, { status: 400 });
  }

  // Contas escolhidas na tela vencem; senão ficam as que o token revelou.
  const chosen = body.accounts?.filter((account) => /^\d+$/.test(account.id ?? ""));
  const accounts = chosen?.length ? chosen : check.accounts;

  if (!accounts.length) {
    return NextResponse.json(
      {
        error:
          "O token é válido, mas nenhuma conta de anúncios apareceu. No Business Manager, adicione as contas como ativo do System User.",
      },
      { status: 400 },
    );
  }

  try {
    await saveCredentials({ accessToken, appSecret, apiVersion, accounts });
  } catch {
    return NextResponse.json({ error: NOWHERE_TO_SAVE }, { status: 501 });
  }

  return NextResponse.json({
    ok: true,
    accounts,
    accessTokenMask: mask(accessToken),
    appSecretMask: mask(appSecret),
    apiVersion,
  });
}

/** Apaga o que a tela salvou; o painel volta a usar as variáveis de ambiente. */
export async function DELETE() {
  await clearCredentials();
  return NextResponse.json({ ok: true });
}
