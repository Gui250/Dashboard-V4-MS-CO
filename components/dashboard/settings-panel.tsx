"use client";

import { useState } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";

type Account = { id: string; name: string };

type Status = {
  configured: boolean;
  accessTokenMask: string;
  appSecretMask: string;
  apiVersion: string;
  accounts: Account[];
  locked: Record<"accessToken" | "appSecret" | "apiVersion" | "accounts", boolean>;
  defaultApiVersion: string;
};

const getStatus = (url: string) => fetch(url).then((r) => r.json() as Promise<Status>);

export function SettingsPanel({
  onSaved,
  variant,
}: {
  onSaved: () => void;
  variant: "setup" | "panel";
}) {
  const { data: status, mutate } = useSWR<Status>("/api/settings", getStatus);

  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  // null = ainda não editado, então segue o valor do servidor.
  const [apiVersionInput, setApiVersionInput] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);


  const apiVersion = apiVersionInput ?? status?.apiVersion ?? "";
  const chosen = selected ?? (status?.accounts ?? []).map((account) => account.id);
  const lockedAll = Boolean(status?.locked.accessToken);

  async function save(accounts?: Account[]) {
    setState("saving");
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken, appSecret, apiVersion, accounts }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Não foi possível salvar.");
        return;
      }
      // O token cheio não fica em memória depois de salvo.
      setAccessToken("");
      setAppSecret("");
      setSelected(null);
      setSaved(true);
      await mutate();
      onSaved();
    } catch {
      setError("Falha de rede ao salvar.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className={cn(variant === "setup" && "border-border bg-card rounded-lg border p-6")}>
      {variant === "setup" && (
        <header className="mb-6">
          <h2 className="flex items-baseline gap-2 text-lg font-extrabold tracking-tight">
            <span className="bg-v4 inline-block h-4 w-1 translate-y-0.5 rounded-[1px]" />
            Conectar à Meta
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Cole o token do System User. O painel testa a credencial na Meta e descobre
            suas contas de anúncio sozinho.
          </p>
        </header>
      )}

      {!status ? (
        <div className="bg-secondary h-40 animate-pulse rounded-md" />
      ) : lockedAll ? (
        <p className="border-border bg-surface-raised text-muted-foreground rounded-md border p-4 text-sm">
          As credenciais vêm das variáveis de ambiente (<code>META_ACCESS_TOKEN</code>) e
          têm precedência sobre qualquer coisa configurada aqui. Para gerenciar pela tela,
          remova a variável do ambiente.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <Field
            label="Token de acesso"
            hint={
              status!.configured
                ? `Salvo: ${status!.accessTokenMask}. Deixe em branco para manter.`
                : "System User token, começa com EAA. Não expira."
            }
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder={status!.configured ? "••••••••  (manter o atual)" : "EAAG…"}
              className="border-border bg-surface-raised focus:border-line-bright w-full rounded-md border px-3 py-2 font-mono text-sm outline-none"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field
              label="App Secret"
              hint={
                status!.appSecretMask
                  ? `Salvo: ${status!.appSecretMask}. Opcional.`
                  : "Opcional. Só é obrigatório se o app exigir App Secret."
              }
            >
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                placeholder="opcional"
                className="border-border bg-surface-raised focus:border-line-bright w-full rounded-md border px-3 py-2 font-mono text-sm outline-none"
              />
            </Field>

            <Field label="Versão da API" hint={`Padrão ${status!.defaultApiVersion}`}>
              <input
                value={apiVersion}
                onChange={(event) => setApiVersionInput(event.target.value)}
                spellCheck={false}
                className="border-border bg-surface-raised focus:border-line-bright tnum w-full rounded-md border px-3 py-2 text-sm outline-none"
              />
            </Field>
          </div>

          {error && (
            <p
              role="alert"
              className="border-destructive bg-destructive/10 rounded-md border px-3 py-2.5 text-sm"
            >
              {error}
            </p>
          )}

          {saved && !error && (
            <p className="text-muted-foreground text-sm">
              Credencial validada na Meta e salva.
            </p>
          )}

          <button
            type="submit"
            disabled={state === "saving" || (!accessToken && !status!.configured)}
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {state === "saving" ? "Verificando na Meta…" : "Verificar e salvar"}
          </button>
        </form>
      )}

      {(status?.accounts.length ?? 0) > 0 && (
        <section className="mt-7">
          <h3 className="eyebrow mb-1">Contas no seletor</h3>
          <p className="text-muted-foreground mb-3 text-xs">
            {status!.locked.accounts
              ? "Definidas por META_AD_ACCOUNTS no ambiente."
              : "Desmarque as que não quer ver no painel."}
          </p>
          <ul className="space-y-1.5">
            {status!.accounts.map((account) => (
              <li key={account.id}>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.includes(account.id)}
                    disabled={status!.locked.accounts}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...chosen, account.id]
                          : chosen.filter((id) => id !== account.id),
                      )
                    }
                    className="accent-foreground size-3.5"
                  />
                  <span className="truncate">{account.name}</span>
                  <span className="text-muted-foreground tnum text-xs">{account.id}</span>
                </label>
              </li>
            ))}
          </ul>

          {selected && !status!.locked.accounts && (
            <button
              type="button"
              disabled={state === "saving" || chosen.length === 0}
              onClick={() =>
                void save(status!.accounts.filter((account) => chosen.includes(account.id)))
              }
              className="border-border mt-3 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Salvar seleção
            </button>
          )}
        </section>
      )}

      <div className="text-muted-foreground mt-7 space-y-2.5 text-xs leading-relaxed">
        <p>
          O token é gravado em <code className="tnum">.meta-credentials.json</code> na
          raiz do projeto, com permissão <code className="tnum">0600</code> e fora do
          Git. Ele nunca é guardado no browser nem devolvido por esta tela — só a versão
          mascarada.
        </p>
        <p className="border-line-bright border-l-2 pl-3">
          Este painel não tem login: quem abrir a URL vê o gasto da conta. Rodando na sua
          máquina, tudo bem. Antes de publicar, ponha autenticação na frente e passe o
          token por <code className="tnum">META_ACCESS_TOKEN</code> no ambiente do
          serviço — a tela então fica só de leitura.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
      <span className="text-muted-foreground mt-1.5 block text-[11px]">{hint}</span>
    </label>
  );
}
