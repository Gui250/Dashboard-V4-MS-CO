"use client";

import { useState, type FormEvent } from "react";
import { money, shortDate } from "@/lib/format";
import type { Sale } from "@/lib/meta-types";
import { Num } from "./num";

type CampaignOption = { id: string; name: string };

const todayISO = () => new Date().toISOString().slice(0, 10);

const inputClass =
  "border-border bg-surface-raised focus:border-line-bright rounded-md border px-2.5 py-1.5 text-sm outline-none";

/**
 * "Livro-caixa" das vendas do WhatsApp — lançadas à mão porque uma venda
 * fechada por conversa nunca passa pelo pixel da Meta. O ROAS por campanha
 * (route.ts) soma essa receita à do pixel.
 */
export function WhatsappSales({
  account,
  sales,
  campaigns,
  salesEnabled,
  mutate,
}: {
  account: string;
  sales: Sale[];
  campaigns: CampaignOption[];
  salesEnabled: boolean;
  mutate: () => void;
}) {
  const [soldOn, setSoldOn] = useState(todayISO());
  const [campaignId, setCampaignId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "deleting">("idle");
  const [error, setError] = useState<string | null>(null);

  const total = sales.reduce((sum, sale) => sum + sale.amount, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      setError("Escolha uma campanha.");
      return;
    }
    // Aceita vírgula: "199,90" -> 199.90.
    const parsed = Number(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Valor precisa ser maior que zero.");
      return;
    }

    setState("saving");
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account,
          campaignId: campaign.id,
          campaignName: campaign.name,
          soldOn,
          amount: parsed,
          note: note.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Não foi possível registrar a venda.");
        return;
      }
      setAmount("");
      setNote("");
      mutate();
    } catch {
      setError("Falha de rede ao registrar a venda.");
    } finally {
      setState("idle");
    }
  }

  async function remove(id: string) {
    setState("deleting");
    setError(null);
    try {
      const response = await fetch(
        `/api/sales?id=${encodeURIComponent(id)}&account=${encodeURIComponent(account)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Não foi possível apagar.");
        return;
      }
      mutate();
    } catch {
      setError("Falha de rede ao apagar.");
    } finally {
      setState("idle");
    }
  }

  return (
    <section className="border-border bg-card rounded-lg border">
      <header className="border-border border-b p-4">
        <h2 className="text-sm font-semibold">Vendas do WhatsApp</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Lançadas à mão: uma venda fechada por conversa nunca chega ao pixel da Meta. O
          ROAS por campanha soma pixel + WhatsApp.
        </p>
      </header>

      {!salesEnabled ? (
        <p className="text-muted-foreground p-4 text-sm">
          Não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para lançar
          vendas aqui.
        </p>
      ) : (
        <>
          <form
            onSubmit={submit}
            className="border-border flex flex-wrap items-end gap-3 border-b p-4"
          >
            <label className="flex flex-col gap-1 text-xs">
              Data
              <input
                type="date"
                value={soldOn}
                max={todayISO()}
                onChange={(event) => setSoldOn(event.target.value)}
                required
                className={`tnum ${inputClass}`}
              />
            </label>

            <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
              Campanha
              <select
                aria-label="Campanha"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                required
                className={inputClass}
              >
                <option value="" disabled>
                  Selecione
                </option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex w-28 flex-col gap-1 text-xs">
              Valor (R$)
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
                required
                className={`tnum text-right ${inputClass}`}
              />
            </label>

            <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
              Observação (opcional)
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                className={inputClass}
              />
            </label>

            <button
              type="submit"
              disabled={state === "saving" || !campaigns.length}
              className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {state === "saving" ? "Registrando…" : "Registrar venda"}
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="border-destructive bg-destructive/10 border-b px-4 py-2.5 text-sm"
            >
              {error}
            </p>
          )}

          {sales.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              Nenhuma venda do WhatsApp neste período. Registre a primeira acima.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {sales.map((sale) => (
                <li
                  key={sale.id}
                  className="grid grid-cols-[3.5rem_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="tnum text-muted-foreground">{shortDate(sale.soldOn)}</span>
                  <span className="min-w-0 truncate">
                    {sale.campaignName}
                    {sale.note && <span className="text-muted-foreground"> · {sale.note}</span>}
                  </span>
                  <span className="tnum text-right">{money(sale.amount)}</span>
                  <button
                    type="button"
                    aria-label={`Apagar venda de ${money(sale.amount)} em ${shortDate(sale.soldOn)}`}
                    disabled={state === "deleting"}
                    onClick={() => remove(sale.id)}
                    className="text-muted-foreground hover:text-destructive text-xs disabled:opacity-40"
                  >
                    Apagar
                  </button>
                </li>
              ))}
              <li className="border-border grid grid-cols-[3.5rem_1fr_auto_auto] items-center gap-3 border-t-4 border-double px-4 py-2.5 text-sm font-semibold">
                <span className="col-span-2">Total do período</span>
                <span className="tnum text-right">
                  <Num value={total} format={money as never} />
                </span>
                <span aria-hidden />
              </li>
            </ul>
          )}
        </>
      )}
    </section>
  );
}
