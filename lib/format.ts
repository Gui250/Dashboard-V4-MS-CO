const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

/** Centavos importam quando o CPC é R$0,15 — mas não num total de R$1.204. */
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const EM_DASH = "—";

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value >= 1000 ? brlCompact.format(value) : brl.format(value);
}

/** Valores unitários mantêm os centavos mesmo acima de mil. */
export function moneyExact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return brl.format(value);
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value >= 10_000 ? compact.format(value) : int.format(value);
}

/** A Meta já devolve ctr em pontos percentuais (1.85 = 1,85%). */
export function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

/** Para taxas calculadas por nós, que vêm como fração (0,2 = 20%). */
export function ratio(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return percent(value * 100, digits);
}

export function decimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(digits).replace(".", ",");
}

export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return month && day ? `${day}/${month}` : iso;
}

export function relativeSeconds(seconds: number): string {
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)}h`;
}

const RANKING_LABELS: Record<string, string> = {
  ABOVE_AVERAGE: "Acima da média",
  AVERAGE: "Na média",
  BELOW_AVERAGE_35: "Abaixo (35% piores)",
  BELOW_AVERAGE_20: "Abaixo (20% piores)",
  BELOW_AVERAGE_10: "Abaixo (10% piores)",
  UNKNOWN: "Dados insuficientes",
};

/** UNKNOWN significa menos de 500 impressões, não desempenho ruim. */
export function ranking(value: string | undefined): string {
  if (!value) return EM_DASH;
  return RANKING_LABELS[value] ?? value;
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Vendas",
  OUTCOME_LEADS: "Leads",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "App",
  LINK_CLICKS: "Cliques no link",
  POST_ENGAGEMENT: "Engajamento",
  LEAD_GENERATION: "Leads",
  CONVERSIONS: "Conversões",
};

export const objective = (value: string | undefined): string =>
  value ? (OBJECTIVE_LABELS[value] ?? value) : EM_DASH;

export type StoredAccount = { id: string; name: string };

/** META_AD_ACCOUNTS="123:MS&CO|456:Outra". Ids não-numéricos são descartados. */
export function parseAccounts(raw: string | undefined): StoredAccount[] {
  return (raw ?? "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf(":");
      const id = (sep === -1 ? entry : entry.slice(0, sep)).trim();
      const name = sep === -1 ? id : entry.slice(sep + 1).trim() || id;
      return { id, name };
    })
    .filter((account) => /^\d+$/.test(account.id));
}

/**
 * Versão exibível de um segredo. O miolo NUNCA aparece: sem isso, mostrar a
 * credencial na tela viria a ser o vazamento que a tela existe para evitar.
 */
export function mask(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 12) return "\u2022".repeat(secret.length);
  return `${secret.slice(0, 6)}${"\u2022".repeat(8)}${secret.slice(-4)}`;
}
