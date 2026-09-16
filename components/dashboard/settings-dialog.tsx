"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SettingsTabs } from "./settings-tabs";

/**
 * <dialog> nativo: foco preso, Esc para fechar e backdrop já vêm do browser.
 * Não vale instalar um componente de modal para reimplementar isso.
 */
export function SettingsDialog({ onSaved }: { onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const params = useSearchParams();
  // Voltando do consentimento do Google (/?google=…), o resultado está aqui dentro.
  const [open, setOpen] = useState(params.has("google"));
  const router = useRouter();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground text-xs"
      >
        Configurar acesso
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label="Configurar acesso"
        className="bg-card text-foreground border-border m-auto w-[min(38rem,calc(100vw-2rem))] rounded-lg border p-6 backdrop:bg-black/70"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-extrabold tracking-tight">
              Configurar acesso
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              A credencial é validada na plataforma antes de ser gravada.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground -mt-1 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <SettingsTabs
          variant="panel"
          onSaved={() => {
            // As contas do seletor vêm do server component, então recarrega.
            router.refresh();
            onSaved();
          }}
        />
      </dialog>
    </>
  );
}
