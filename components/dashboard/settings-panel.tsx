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
  /** O token vigente vem de META_ACCESS_TOKEN (a tela não salvou nada). */
  fromEnv: boolean;
  envHasToken: boolean;
  defaultApiVersion: string;
};

const getStatus = async (url: string): Promise<Status> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Estado indisponível (${response.status})`);
  return response.json();
};

export function SettingsPanel({
  onSaved,
  variant,
}: {
  onSaved: () => void;
  variant: "setup" | "panel";
}) {
  const {
    data: status,
    error: statusError,
    mutate,
  } = useSWR<Status>("/api/settings", getStatus, {
    // Sem isto, uma busca que falha deixa em tela o último estado bom sem
    // qualquer sinal — e "travado pelo ambiente" velho passa por verdade atual.
    keepPreviousData: false,
    errorRetryInterval: 4000,
  });

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

  async function resetToEnv() {
    setState("saving");
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings", { method: "DELETE" });
      if (!response.ok) {
        setError("Não foi possível voltar ao token do ambiente.");
        return;
      }
      setSelected(null);
      await mutate();
      onSaved();
    } catch {
      setError("Falha de rede.");
    } finally {
      setState("idle");
    }
  }

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

      {statusError ? (
        <div
          role="alert"
          className="border-border bg-surface-raised rounded-md border p-4 text-sm"
        >
          <p className="text-foreground font-medium">
            Não deu para ler a configuração atual
          </p>
          <p className="text-muted-foreground mt-1">
            {(statusError as Error).message}. O servidor pode ter reiniciado — o que
            estiver na tela pode estar desatualizado.
          </p>
          <button
            type="button"
            onClick={() => void mutate()}
            className="border-border mt-3 rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            Tentar de novo
          </button>
        </div>
      ) : !status ? (
        <div className="bg-secondary h-40 animate-pulse rounded-md" />
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
                ? `${status!.fromEnv ? "Vindo de META_ACCESS_TOKEN" : "Salvo"}: ${status!.accessTokenMask}. Deixe em branco para manter, ou cole outro para substituir.`
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

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={state === "saving" || (!accessToken && !status!.configured)}
              className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {state === "saving" ? "Verificando na Meta…" : "Verificar e salvar"}
            </button>
            {!status!.fromEnv && status!.envHasToken && (
              <button
                type="button"
                disabled={state === "saving"}
                onClick={() => void resetToEnv()}
                className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-40"
              >
                Voltar a usar o token do ambiente
              </button>
            )}
          </div>
        </form>
      )}

      {!statusError && (status?.accounts.length ?? 0) > 0 && (
        <AccountList
          accounts={status!.accounts}
          chosen={chosen}
          dirty={selected !== null}
          saving={state === "saving"}
          onChange={setSelected}
          onSave={() =>
            void save(status!.accounts.filter((account) => chosen.includes(account.id)))
          }
        />
      )}

      {variant === "setup" && <MetaHowTo />}

      <div className="text-muted-foreground mt-7 space-y-2.5 text-xs leading-relaxed">
        <p>
          O que for salvo aqui vale mais que as variáveis de ambiente. Na sua máquina vai
          para <code className="tnum">.meta-credentials.json</code> (permissão{" "}
          <code className="tnum">0600</code>, fora do Git); em servidor sem disco
          gravável, como a Vercel, vai para um cookie cifrado que só vale neste
          navegador. O token nunca é devolvido por esta tela — só a versão mascarada.
        </p>
        <p className="border-line-bright border-l-2 pl-3">
          Este painel não tem login: quem abrir a URL vê o gasto da conta. Rodando na sua
          máquina, tudo bem. Antes de publicar, ponha autenticação na frente.
        </p>
      </div>
    </div>
  );
}

/** Contas descobertas pela credencial; desmarcar tira do seletor do painel. */
export function AccountList({
  accounts,
  chosen,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  accounts: Account[];
  chosen: string[];
  /** A seleção foi editada e ainda não salva. */
  dirty: boolean;
  saving: boolean;
  onChange: (ids: string[]) => void;
  onSave: () => void;
}) {
  return (
    <section className="mt-7">
      <h3 className="eyebrow mb-1">Contas no seletor</h3>
      <p className="text-muted-foreground mb-3 text-xs">
        Desmarque as que não quer ver no painel.
      </p>
      <ul className="space-y-1.5">
        {accounts.map((account) => (
          <li key={account.id}>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(account.id)}
                onChange={(event) =>
                  onChange(
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

      {dirty && (
        <button
          type="button"
          disabled={saving || chosen.length === 0}
          onClick={onSave}
          className="border-border mt-3 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          Salvar seleção
        </button>
      )}
    </section>
  );
}

export function Field({
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

function MetaHowTo() {
  return (
    <details className="text-muted-foreground mt-6 text-xs">
      <summary className="hover:text-foreground cursor-pointer">
        Como gerar o token do System User
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-4 leading-relaxed">
        <li>
          Em{" "}
          <a
            className="underline underline-offset-2"
            href="https://developers.facebook.com/apps"
            target="_blank"
            rel="noreferrer"
          >
            developers.facebook.com/apps
          </a>
          , crie um app do tipo <strong>Empresa</strong> e adicione o produto Marketing API.
        </li>
        <li>
          Em{" "}
          <a
            className="underline underline-offset-2"
            href="https://business.facebook.com/settings"
            target="_blank"
            rel="noreferrer"
          >
            business.facebook.com/settings
          </a>
          , crie um <strong>Usuário do sistema</strong> com função Admin.
        </li>
        <li>
          Nele, <em>Adicionar ativos</em> → Contas de anúncios → marque as contas com
          permissão <strong>Ver desempenho</strong>.
        </li>
        <li>
          <em>Gerar novo token</em> → escolha o app → marque <code>ads_read</code> e{" "}
          <code>business_management</code> → deixe <strong>desmarcada</strong> a caixa
          &ldquo;O token expira em 60 dias&rdquo;.
        </li>
        <li>Cole o token acima.</li>
      </ol>
    </details>
  );
}
