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
 * Escrever credencial é ação privilegiada. Local, é conveniência; exposto na
 * internet sem login, seria um formulário aberto para trocar o token da conta
 * de anúncios de outra pessoa.
 *
 * O portão é o modo de execução, não o header Host: Host vem do cliente e
 * bastaria mandar "Host: localhost" para burlar. Uma checagem falsificável que
 * parece segurança é pior que checagem nenhuma. Em build de produção, gravar
 * pela tela exige opt-in explícito de quem controla o servidor.
 */
function writable(): { ok: true } | { ok: false; message: string } {
  if (process.env.ALLOW_REMOTE_SETTINGS === "1") return { ok: true };
  if (process.env.NODE_ENV !== "production") return { ok: true };
  return {
    ok: false,
    message:
      "Em produção, as credenciais vêm das variáveis de ambiente. Defina META_ACCESS_TOKEN no servidor, ou ALLOW_REMOTE_SETTINGS=1 para liberar esta tela (só faça isso atrás de autenticação).",
  };
}

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
  const gate = writable();
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 403 });

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

  saveCredentials({ accessToken, appSecret, apiVersion, accounts });

  return NextResponse.json({
    ok: true,
    accounts,
    accessTokenMask: mask(accessToken),
    appSecretMask: mask(appSecret),
    apiVersion,
  });
}

export async function DELETE() {
  const gate = writable();
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 403 });
  clearCredentials();
  return NextResponse.json({ ok: true });
}
