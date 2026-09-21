import { NextResponse } from "next/server";
import { resolveAccounts } from "@/lib/meta";
import { addSale, deleteSale, salesConfigured } from "@/lib/sales";

/** Mesmo padrão do NOWHERE_TO_SAVE de /api/settings: diz exatamente o que falta. */
const NOWHERE_TO_SAVE =
  "Vendas do WhatsApp não estão configuradas neste servidor. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.";

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function POST(request: Request) {
  if (!salesConfigured()) {
    return NextResponse.json({ error: NOWHERE_TO_SAVE }, { status: 501 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    account?: string;
    campaignId?: string;
    campaignName?: string;
    soldOn?: string;
    amount?: number;
    note?: string;
  };

  // Fronteira de confiança: mesma allowlist do /api/insights, não o corpo da requisição.
  const allowed = await resolveAccounts();
  const account = allowed.find((a) => a.id === body.account);
  if (!account) {
    return NextResponse.json({ error: "Conta fora da lista configurada." }, { status: 400 });
  }
  if (!/^\d+$/.test(body.campaignId ?? "")) {
    return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  }
  if (!isDate(body.soldOn)) {
    return NextResponse.json({ error: "Data inválida. Use AAAA-MM-DD." }, { status: 400 });
  }
  const amount = Number(body.amount);
  const hasCents = Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
  if (!Number.isFinite(amount) || amount <= 0 || !hasCents) {
    return NextResponse.json(
      { error: "Valor precisa ser maior que zero, com no máximo 2 casas decimais." },
      { status: 400 },
    );
  }
  const note = body.note?.trim() || null;
  if (note && note.length > 200) {
    return NextResponse.json({ error: "Observação: até 200 caracteres." }, { status: 400 });
  }

  try {
    const sale = await addSale({
      accountId: account.id,
      campaignId: body.campaignId!,
      campaignName: body.campaignName?.trim() || body.campaignId!,
      soldOn: body.soldOn,
      amount,
      note,
    });
    return NextResponse.json({ ok: true, sale });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gravar no Supabase." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!salesConfigured()) {
    return NextResponse.json({ error: NOWHERE_TO_SAVE }, { status: 501 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const accountParam = params.get("account");

  const allowed = await resolveAccounts();
  const account = allowed.find((a) => a.id === accountParam);
  if (!account || !id) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    await deleteSale(id, account.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao apagar no Supabase." },
      { status: 502 },
    );
  }
}
