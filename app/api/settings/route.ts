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

const LOOPBACK = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost"]);

/**
 * Escrever credencial é ação privilegiada — mas com o peso certo:
 *
 * O formulário NÃO expõe o token. O GET só devolve `mask()`, então o pior que
 * um estranho faz aqui é sobrescrever a credencial e quebrar o painel de quem
 * o publicou: vandalismo, não roubo. (Num deploy, a exposição que de fato
 * importa é outra — o painel inteiro não tem autenticação nenhuma.)
 *
 * Por isso o portão libera a própria máquina mesmo em build de produção:
 * `npm start` no seu computador não é "exposto na internet", e travar isso
 * bloqueava o dono sem proteger nada.
 *
 * O Next preenche `x-forwarded-for` em TODA requisição, com o endereço de quem
 * conectou (`::1` no localhost, o IP real pela rede) — não é preciso proxy para
 * o header existir. Havendo proxy de verdade (Vercel, nginx), o primeiro
 * endereço da lista é o do cliente de origem, que é o que interessa aqui.
 *
 * LIMITE CONHECIDO: um cliente que já alcança a porta pode forjar esse header e
 * se passar por local. A checagem só carrega peso porque o estrago possível é
 * vandalismo, não vazamento de segredo. Onde isso não bastar, use
 * META_ACCESS_TOKEN no ambiente e a tela fica só de leitura.
 */
function writable(request: Request): { ok: true } | { ok: false; message: string } {
  if (process.env.ALLOW_REMOTE_SETTINGS === "1") return { ok: true };
  if (process.env.NODE_ENV !== "production") return { ok: true };

  const client = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (LOOPBACK.has(client)) return { ok: true };

  return {
    ok: false,
    message:
      "Esta requisição não veio da máquina onde o painel roda, então a tela não grava credencial. Defina META_ACCESS_TOKEN nas variáveis de ambiente do servidor, ou ALLOW_REMOTE_SETTINGS=1 para liberar a tela — e nesse caso ponha autenticação na frente do painel, que hoje não tem nenhuma.",
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
  const gate = writable(request);
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

export async function DELETE(request: Request) {
  const gate = writable(request);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 403 });
  clearCredentials();
  return NextResponse.json({ ok: true });
}
