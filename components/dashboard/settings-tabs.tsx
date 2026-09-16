"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./settings-panel";
import { GoogleSettingsPanel } from "./google-settings-panel";

export type Source = "meta" | "google";

export const SOURCE_LABELS: Record<Source, string> = {
  meta: "Meta",
  google: "Google Ads",
};

/** Uma plataforma por vez; voltar do OAuth do Google abre direto na aba dele. */
export function SettingsTabs({
  onSaved,
  variant,
}: {
  onSaved: () => void;
  variant: "setup" | "panel";
}) {
  const params = useSearchParams();
  const [tab, setTab] = useState<Source>(params.has("google") ? "google" : "meta");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Plataforma"
        className="border-border mb-4 flex overflow-hidden rounded-md border text-xs"
      >
        {(Object.keys(SOURCE_LABELS) as Source[]).map((source) => (
          <button
            key={source}
            type="button"
            role="tab"
            aria-selected={tab === source}
            onClick={() => setTab(source)}
            className={cn(
              "px-3 py-1.5 font-medium transition-colors",
              tab === source
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {SOURCE_LABELS[source]}
          </button>
        ))}
      </div>

      {tab === "meta" ? (
        <SettingsPanel variant={variant} onSaved={onSaved} />
      ) : (
        <GoogleSettingsPanel variant={variant} onSaved={onSaved} />
      )}
    </div>
  );
}
