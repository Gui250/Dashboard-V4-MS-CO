import "server-only";
import type { Sale } from "./meta-types";

/**
 * Cliente do Supabase por PostgREST puro, sem @supabase/supabase-js: são só
 * três chamadas (listar, inserir, apagar), não vale a dependência nova. Usa a
 * `service_role` key — nunca vai ao browser, mesmo padrão do token da Meta.
 *
 * `cache: "no-store"` sempre: uma venda lançada tem que aparecer no refresh
 * seguinte do SWR (120s), não pode herdar o REVALIDATE de 300s de lib/meta.ts.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function salesConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

function headers(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
}

/** Forma crua da tabela — colunas em snake_case, `amount` já vem number (numeric no PostgREST vira JSON number). */
type SaleRow = {
  id: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  sold_on: string;
  amount: number;
  note: string | null;
  created_at: string;
};

function fromRow(row: SaleRow): Sale {
  return {
    id: row.id,
    accountId: row.account_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    soldOn: row.sold_on,
    amount: row.amount,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function listSales(accountId: string, since: string, until: string): Promise<Sale[]> {
  const query = new URLSearchParams();
  query.set("account_id", `eq.${accountId}`);
  query.append("sold_on", `gte.${since}`);
  query.append("sold_on", `lte.${until}`);
  query.set("order", "sold_on.desc");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_sales?${query}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase respondeu ${res.status}`);
  const rows = (await res.json()) as SaleRow[];
  return rows.map(fromRow);
}

export async function addSale(sale: {
  accountId: string;
  campaignId: string;
  campaignName: string;
  soldOn: string;
  amount: number;
  note: string | null;
}): Promise<Sale> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_sales`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify({
      account_id: sale.accountId,
      campaign_id: sale.campaignId,
      campaign_name: sale.campaignName,
      sold_on: sale.soldOn,
      amount: sale.amount,
      note: sale.note,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase respondeu ${res.status}`);
  const [row] = (await res.json()) as SaleRow[];
  return fromRow(row);
}

/** Filtra por `id` e `account_id` juntos — a mesma fronteira de confiança do resto do painel. */
export async function deleteSale(id: string, accountId: string): Promise<void> {
  const query = new URLSearchParams({ id: `eq.${id}`, account_id: `eq.${accountId}` });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_sales?${query}`, {
    method: "DELETE",
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase respondeu ${res.status}`);
}
