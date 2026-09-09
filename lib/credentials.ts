import "server-only";
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mask, parseAccounts, type StoredAccount } from "./format";

export { mask, parseAccounts };
export type { StoredAccount };

/**
 * Credenciais podem vir de dois lugares:
 *
 *  1. Variáveis de ambiente — vencem sempre. É como se configura em produção
 *     (Vercel, Docker), e nesse caso a tela de configuração fica só de leitura:
 *     um formulário não deve poder sobrescrever o que a plataforma define.
 *  2. Arquivo local gravado pela tela de configuração. É o caminho de quem
 *     roda na própria máquina e não quer editar .env na mão.
 */
const STORE = join(process.cwd(), ".meta-credentials.json");

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


export function getCredentials(): Credentials {
  const stored = readStore();
  const envAccounts = parseAccounts(process.env.META_AD_ACCOUNTS);

  return {
    accessToken: process.env.META_ACCESS_TOKEN || stored.accessToken || "",
    appSecret: process.env.META_APP_SECRET || stored.appSecret || "",
    apiVersion:
      process.env.META_API_VERSION || stored.apiVersion || DEFAULT_API_VERSION,
    accounts: envAccounts.length ? envAccounts : (stored.accounts ?? []),
  };
}

/** Quais campos o ambiente fixou — a tela desabilita esses. */
export function lockedByEnv() {
  return {
    accessToken: Boolean(process.env.META_ACCESS_TOKEN),
    appSecret: Boolean(process.env.META_APP_SECRET),
    apiVersion: Boolean(process.env.META_API_VERSION),
    accounts: parseAccounts(process.env.META_AD_ACCOUNTS).length > 0,
  };
}

export function saveCredentials(patch: Partial<Credentials>): void {
  const next: StoredFile = {
    ...readStore(),
    ...patch,
    savedAt: new Date().toISOString(),
  };
  // Escreve e restringe a permissão: o arquivo guarda um token que não expira.
  writeFileSync(STORE, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(STORE, 0o600);
}

export function clearCredentials(): void {
  try {
    unlinkSync(STORE);
  } catch {
    // Já não existia — o resultado desejado é o mesmo.
  }
}

