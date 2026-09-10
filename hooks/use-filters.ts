"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type Filters = {
  account: string;
  preset: string;
  since: string;
  until: string;
  level: "campaign" | "adset" | "ad";
  status: "all" | "active" | "paused";
  objective: string;
  platform: string;
  q: string;
  sort: string;
  /** Anúncio focado ao clicar na pista de criativos. */
  ad: string;
  /** Leitura ativa da série: retorno | custo | fadiga. */
  metric: string;
  /** Tamanho do balde da série: dia, semana ou mês. */
  granularity: "day" | "week" | "month";
};

const DEFAULTS: Filters = {
  account: "",
  preset: "last_30d",
  since: "",
  until: "",
  level: "campaign",
  status: "all",
  objective: "",
  platform: "",
  q: "",
  sort: "spend_desc",
  ad: "",
  metric: "retorno",
  granularity: "day",
};

/**
 * Os filtros moram na URL: link compartilhável, botão voltar funciona e não
 * entra biblioteca de estado. URLSearchParams já é nativo.
 */
export function useFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const filters = useMemo(() => {
    const next = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Filters)[]) {
      const value = params.get(key);
      if (value) next[key] = value as never;
    }
    return next;
  }, [params]);

  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        // Valor igual ao padrão sai da URL — mantém o link curto e legível.
        if (!value || value === DEFAULTS[key as keyof Filters]) next.delete(key);
        else next.set(key, String(value));
      }
      // Datas personalizadas e preset são excludentes: um limpa o outro.
      if (patch.preset) {
        next.delete("since");
        next.delete("until");
      }
      if (patch.since || patch.until) next.delete("preset");

      router.replace(next.size ? `/?${next}` : "/", { scroll: false });
    },
    [params, router],
  );

  /** Chave do SWR: só o que o servidor precisa. O resto filtra no cliente. */
  const queryKey = useMemo(() => {
    const query = new URLSearchParams();
    if (filters.account) query.set("account", filters.account);
    if (filters.since && filters.until) {
      query.set("since", filters.since);
      query.set("until", filters.until);
    } else {
      query.set("preset", filters.preset);
    }
    query.set("level", filters.level);
    if (filters.status !== "all") query.set("status", filters.status);
    if (filters.granularity !== "day") query.set("granularity", filters.granularity);
    return `/api/insights?${query}`;
  }, [
    filters.account,
    filters.since,
    filters.until,
    filters.preset,
    filters.level,
    filters.status,
    filters.granularity,
  ]);

  return { filters, set, queryKey };
}

export const PRESET_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_14d", label: "Últimos 14 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  // Períodos longos são o que dá sentido à granularidade mensal.
  { value: "last_90d", label: "Últimos 90 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "this_year", label: "Este ano" },
  { value: "maximum", label: "Todo o período" },
] as const;
