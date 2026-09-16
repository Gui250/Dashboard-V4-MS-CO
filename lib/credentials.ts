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
 *     que a plataforma bloqueou não pode deixar o painel sem saída: a tela
 *     precisa conseguir trocar. Na máquina local vai para arquivo; em
 *     serverless (disco somente leitura) vai para um cookie httpOnly cifrado,
 *     válido só naquele navegador.
 *  2. Variáveis de ambiente — valem quando a tela não salvou nada.
 *
 * Meta e Google Ads têm cada um o seu arquivo e o seu cookie, mas passam pela
 * mesma plumbing abaixo.
 */

/** Chave do cookie, derivada de um segredo que só o servidor conhece. */
function cookieKey(): Buffer | null {
  const secret =
    process.env.SETTINGS_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.META_ACCESS_TOKEN ||
    process.env.GOOGLE_ADS_CLIENT_SECRET;
  return secret ? createHash("sha256").update(`cookie:${secret}`).digest() : null;
}

function seal(data: object): string | null {
  const key = cookieKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal<T>(value: string | undefined): T | null {
  const key = cookieKey();
  if (!key || !value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(),
    ) as T;
  } catch {
    // Segredo do servidor mudou ou cookie adulterado: ignora e cai no ambiente.
    return null;
  }
}

/**
 * Arquivo local com cookie cifrado como alternativa, para um conjunto de
 * credenciais. `path` vem pronto de quem chama para o `join(process.cwd(), …)`
 * ficar com literal — dinâmico, o Turbopack empacota a pasta inteira.
 */
function store<T extends object>(path: string, cookie: string) {
  return {
    async read(): Promise<Partial<T>> {
      const sealed = unseal<Partial<T>>((await cookies()).get(cookie)?.value);
      if (sealed) return sealed;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as Partial<T>;
      } catch {
        // Ausente ou ilegível é o estado normal antes da primeira configuração.
        return {};
      }
    },

    /** Lança se não houver onde gravar: disco somente leitura e nenhum segredo para cifrar o cookie. */
    async save(credentials: T): Promise<void> {
      const data = { ...credentials, savedAt: new Date().toISOString() };
      try {
        // Escreve e restringe a permissão: o arquivo guarda um token que não expira.
        writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
        chmodSync(path, 0o600);
        return;
      } catch {
        // Serverless: o diretório do app é somente leitura. Segue para o cookie.
      }

      const sealed = seal(data);
      if (!sealed) throw new Error("Sem disco gravável e sem segredo para o cookie.");
      (await cookies()).set(cookie, sealed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    },

    async clear(): Promise<void> {
      (await cookies()).delete(cookie);
      try {
        unlinkSync(path);
      } catch {
        // Já não existia, ou o disco é somente leitura — sem arquivo para apagar.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export type Credentials = {
  accessToken: string;
  appSecret: string;
  apiVersion: string;
  accounts: StoredAccount[];
};

export const DEFAULT_API_VERSION = "v26.0";

const meta = store<Credentials>(
  join(process.cwd(), ".meta-credentials.json"),
  "meta-credentials",
);

export async function getCredentials(): Promise<Credentials & { fromEnv: boolean }> {
  const saved = await meta.read();
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

export const saveCredentials = (credentials: Credentials) => meta.save(credentials);
export const clearCredentials = () => meta.clear();

// ---------------------------------------------------------------------------
// Google Ads
// ---------------------------------------------------------------------------

/**
 * O Google não tem "token que não expira": o acesso é OAuth2 com refresh token,
 * emitido para um client (ID + secret) de um projeto no Google Cloud, mais o
 * developer token do Centro de API do Google Ads. `loginCustomerId` é a conta
 * de administrador (MCC) quando as contas são acessadas por ela.
 */
export type GoogleCredentials = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId: string;
  apiVersion: string;
  accounts: StoredAccount[];
};

export const DEFAULT_GOOGLE_API_VERSION = "v25";

const google = store<GoogleCredentials>(
  join(process.cwd(), ".google-credentials.json"),
  "google-credentials",
);

export async function getGoogleCredentials(): Promise<
  GoogleCredentials & { fromEnv: boolean }
> {
  const saved = await google.read();
  // O client pode ser salvo antes do refresh token (o fluxo OAuth vem depois),
  // então "a tela salvou algo" é o client id, não o token.
  if (saved.clientId) {
    return {
      developerToken: saved.developerToken ?? "",
      clientId: saved.clientId,
      clientSecret: saved.clientSecret ?? "",
      refreshToken: saved.refreshToken ?? "",
      loginCustomerId: saved.loginCustomerId ?? "",
      apiVersion: saved.apiVersion || DEFAULT_GOOGLE_API_VERSION,
      accounts: saved.accounts ?? [],
      fromEnv: false,
    };
  }

  return {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
    loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, ""),
    apiVersion: process.env.GOOGLE_ADS_API_VERSION || DEFAULT_GOOGLE_API_VERSION,
    accounts: parseAccounts(process.env.GOOGLE_ADS_CUSTOMERS),
    fromEnv: Boolean(process.env.GOOGLE_ADS_REFRESH_TOKEN),
  };
}

export const envHasGoogle = () => Boolean(process.env.GOOGLE_ADS_REFRESH_TOKEN);

export const saveGoogleCredentials = (credentials: GoogleCredentials) =>
  google.save(credentials);
export const clearGoogleCredentials = () => google.clear();
