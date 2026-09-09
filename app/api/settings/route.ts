import { NextResponse } from "next/server";
import {
  clearCredentials,
  DEFAULT_API_VERSION,
  getCredentials,
  lockedByEnv,
  mask,
  saveCredentials,
  type StoredAccount,
} from "@/lib/credentials";
import { verifyToken } from "@/lib/meta";

/**
 * Onde este painel guarda credencial é decisão de quem o hospeda, não de uma
 * heurística sobre a origem da requisição:
 *
 * - `META_ACCESS_TOKEN` no ambiente vence e deixa a tela só de leitura. É o
 *   controle de produção, e é não-falsificável.
 * - Sem isso, a tela grava em arquivo. Em serverless o disco é somente leitura
 *   e a gravação falha sozinha, com a mensagem abaixo.
 *
 * Não há portão por endereço de origem. Já houve, e ele bloqueava o dono na
 * própria máquina enquanto protegia pouco: o `GET` só devolve `mask()`, então o
 * formulário não vaza o token — o pior caso é vandalismo. E a exposição que
 * importa num deploy é outra: o painel inteiro não tem autenticação.
 */
const READ_ONLY_FS =
  "Este servidor não permite gravar arquivos, então a tela não pode salvar a credencial. Defina META_ACCESS_TOKEN nas variáveis de ambiente do serviço.";

/** Estado atual, sempre mascarado — o token cheio nunca volta ao browser. */
export async function GET() {
  const credentials = getCredentials();
  return NextResponse.json({
    configured: Boolean(credentials.accessToken),
    accessTokenMask: mask(credentials.accessToken),
    appSecretMask: mask(credentials.appSecret),
    apiVersion: credentials.apiVersion,
    accounts: credentials.accounts,
    locked: lockedByEnv(),
    defaultApiVersion: DEFAULT_API_VERSION,
  });
}

export async function POST(request: Request) {
  const locked = lockedByEnv();
  if (locked.accessToken) {
    return NextResponse.json(
      {
        error:
          "META_ACCESS_TOKEN está definido no ambiente e tem precedência. Remova a variável para gerenciar o token por aqui.",
      },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    accessToken?: string;
    appSecret?: string;
    apiVersion?: string;
    accounts?: StoredAccount[];
  };

  const current = getCredentials();
  // Token em branco no formulário significa "mantém o que já está salvo",
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
    saveCredentials({ accessToken, appSecret, apiVersion, accounts });
  } catch {
    // Em serverless (Vercel, Lambda) o diretório do app é somente leitura.
    // É o sinal honesto de "aqui não dá" — não uma heurística sobre a origem.
    return NextResponse.json({ error: READ_ONLY_FS }, { status: 501 });
  }

  return NextResponse.json({
    ok: true,
    accounts,
    accessTokenMask: mask(accessToken),
    appSecretMask: mask(appSecret),
    apiVersion,
  });
}

export async function DELETE() {
  try {
    clearCredentials();
  } catch {
    return NextResponse.json({ error: READ_ONLY_FS }, { status: 501 });
  }
  return NextResponse.json({ ok: true });
}
