import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import { mask, parseAccounts, type StoredAccount } from "./format";

export { mask, parseAccounts };
export type { StoredAccount };

/**
 * Credenciais podem vir de dois lugares:
 *
 *  1. O que foi salvo pela tela de configuração — vence. Um token do ambiente
 *     que a Meta bloqueou não pode deixar o painel sem saída: a tela precisa
 *     conseguir trocar. Na máquina local vai para arquivo; em serverless (disco
 *     somente leitura) vai para um cookie httpOnly cifrado, válido só naquele
 *     navegador.
 *  2. Variáveis de ambiente — valem quando a tela não salvou nada.
 */
const STORE = join(process.cwd(), ".meta-credentials.json");
const COOKIE = "meta-credentials";

export type Credentials = {
  accessToken: string;
  appSecret: string;
  apiVersion: string;
  accounts: StoredAccount[];
};

export const DEFAULT_API_VERSION = "v26.0";

type StoredFile = Partial<Credentials> & { savedAt?: string };

function readStore(): StoredFile {
  try {
    return JSON.parse(readFileSync(STORE, "utf8")) as StoredFile;
  } catch {
    // Ausente ou ilegível é o estado normal antes da primeira configuração.
    return {};
  }
}

/** Chave do cookie, derivada de um segredo que só o servidor conhece. */
function cookieKey(): Buffer | null {
  const secret =
    process.env.SETTINGS_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.META_ACCESS_TOKEN;
  return secret ? createHash("sha256").update(`cookie:${secret}`).digest() : null;
}

function seal(data: StoredFile): string | null {
  const key = cookieKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal(value: string | undefined): StoredFile | null {
  const key = cookieKey();
  if (!key || !value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(),
    ) as StoredFile;
  } catch {
    // Segredo do servidor mudou ou cookie adulterado: ignora e cai no ambiente.
    return null;
  }
}

async function readSaved(): Promise<StoredFile> {
  return unseal((await cookies()).get(COOKIE)?.value) ?? readStore();
}

export async function getCredentials(): Promise<Credentials & { fromEnv: boolean }> {
  const saved = await readSaved();
  if (saved.accessToken) {
    return {
      accessToken: saved.accessToken,
      appSecret: saved.appSecret ?? "",
      apiVersion: saved.apiVersion || DEFAULT_API_VERSION,
      accounts: saved.accounts ?? [],
      fromEnv: false,
    };
  }

  return {
    accessToken: process.env.META_ACCESS_TOKEN || "",
    appSecret: process.env.META_APP_SECRET || "",
    apiVersion: process.env.META_API_VERSION || DEFAULT_API_VERSION,
    accounts: parseAccounts(process.env.META_AD_ACCOUNTS),
    fromEnv: Boolean(process.env.META_ACCESS_TOKEN),
  };
}

/** Há um token no ambiente para onde voltar se a configuração da tela for apagada. */
export const envHasToken = () => Boolean(process.env.META_ACCESS_TOKEN);

/** Lança se não houver onde gravar: disco somente leitura e nenhum segredo para cifrar o cookie. */
export async function saveCredentials(credentials: Credentials): Promise<void> {
  const data: StoredFile = { ...credentials, savedAt: new Date().toISOString() };
  try {
    // Escreve e restringe a permissão: o arquivo guarda um token que não expira.
    writeFileSync(STORE, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(STORE, 0o600);
    return;
  } catch {
    // Serverless: o diretório do app é somente leitura. Segue para o cookie.
  }

  const sealed = seal(data);
  if (!sealed) throw new Error("Sem disco gravável e sem segredo para o cookie.");
  (await cookies()).set(COOKIE, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearCredentials(): Promise<void> {
  (await cookies()).delete(COOKIE);
  try {
    unlinkSync(STORE);
  } catch {
    // Já não existia, ou o disco é somente leitura — sem arquivo para apagar.
  }
}
