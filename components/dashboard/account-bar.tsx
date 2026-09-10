"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { relativeSeconds } from "@/lib/format";
import { PRESET_OPTIONS, type Filters } from "@/hooks/use-filters";
import { SettingsDialog } from "./settings-dialog";

export type AccountOption = { id: string; name: string };

export function AccountBar({
  accounts,
  filters,
  onFilterChange,
  fetchedAt,
  loading,
  onRefresh,
}: {
  accounts: AccountOption[];
  filters: Filters;
  onFilterChange: (patch: Partial<Filters>) => void;
  fetchedAt: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const custom = Boolean(filters.since && filters.until);

  return (
    <header className="border-border bg-ink/90 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
        <h1 className="flex items-baseline gap-2 pr-2">
          <span className="bg-v4 inline-block h-4 w-1 translate-y-0.5 rounded-[1px]" />
          <span className="text-[15px] font-extrabold tracking-tight">V4 Company</span>
          <span className="text-muted-foreground text-[15px] font-medium">MS&amp;CO</span>
        </h1>

        <select
          aria-label="Conta de anúncios"
          value={filters.account || accounts[0]?.id || ""}
          onChange={(event) => onFilterChange({ account: event.target.value, ad: "" })}
          className="border-border bg-surface-raised rounded-md border px-2.5 py-1.5 text-xs"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Período"
          value={custom ? "custom" : filters.preset}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "custom") {
              const today = new Date().toISOString().slice(0, 10);
              const weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
              onFilterChange({ since: weekAgo, until: today });
            } else {
              onFilterChange({ preset: value });
            }
          }}
          className="border-border bg-surface-raised rounded-md border px-2.5 py-1.5 text-xs"
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {/* Um preset vindo da URL fora da lista faria o select exibir a
              primeira opção, mentindo sobre o filtro em vigor. */}
          {!custom &&
            !PRESET_OPTIONS.some((option) => option.value === filters.preset) && (
              <option value={filters.preset}>{filters.preset}</option>
            )}
          <option value="custom">Personalizado…</option>
        </select>

        {custom && (
          <span className="flex items-center gap-1.5 text-xs">
            {/* input[type=date] nativo: o calendário do sistema já é melhor
                que qualquer picker que eu instalasse. */}
            <input
              type="date"
              aria-label="Data inicial"
              value={filters.since}
              max={filters.until}
              onChange={(event) => onFilterChange({ since: event.target.value })}
              className="border-border bg-surface-raised tnum rounded-md border px-2 py-1.5"
            />
            <span className="text-muted-foreground">até</span>
            <input
              type="date"
              aria-label="Data final"
              value={filters.until}
              min={filters.since}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => onFilterChange({ until: event.target.value })}
              className="border-border bg-surface-raised tnum rounded-md border px-2 py-1.5"
            />
          </span>
        )}

        <div className="ml-auto flex items-center gap-4">
          <SettingsDialog onSaved={onRefresh} />
          <LiveIndicator fetchedAt={fetchedAt} loading={loading} onRefresh={onRefresh} />
        </div>
      </div>
    </header>
  );
}

/**
 * O pulso é a única razão de o painel "parecer" ao vivo. A Meta recalcula
 * insights a cada ~15 min, então o texto diz honestamente quando os dados
 * chegaram, em vez de prometer tempo real que a API não entrega.
 */
function LiveIndicator({
  fetchedAt,
  loading,
  onRefresh,
}: {
  fetchedAt: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!fetchedAt) return;
    const started = new Date(fetchedAt).getTime();
    const update = () => setSeconds(Math.max(0, Math.round((Date.now() - started) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [fetchedAt]);

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      title="Atualizar agora"
      className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs disabled:opacity-60"
    >
      <span
        className={cn(
          "size-1.5 rounded-full transition-colors",
          loading ? "bg-foreground animate-pulse" : "bg-foreground/40",
        )}
      />
      <span className="tnum">
        {loading ? "atualizando…" : fetchedAt ? relativeSeconds(seconds) : "—"}
      </span>
    </button>
  );
}
