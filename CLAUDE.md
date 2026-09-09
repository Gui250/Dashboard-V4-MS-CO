# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Painel de tráfego pago que lê a Marketing API da Meta ao vivo. Next.js 16 (App
Router) + React 19 + Tailwind v4 + shadcn/ui (preset `radix-nova`). Interface e
comentários em pt-BR. Sem banco, sem worker, sem cron.

## Comandos

```bash
npm run dev                                       # localhost:3000
npm run build                                     # inclui typecheck
npm run lint
npm test                                          # node --test lib/*.test.ts
node --test lib/normalize.test.ts                 # um arquivo
node --test --test-name-pattern "mediana" lib/*.test.ts   # um teste
npx tsc --noEmit                                  # typecheck isolado
```

Não há vitest nem jest — os testes rodam no runner nativo do Node com type
stripping. Isso impõe duas regras:

- **Imports em arquivos `*.test.ts` precisam da extensão `.ts`** (`from
  "./normalize.ts"`). Por isso `allowImportingTsExtensions` está no tsconfig.
- **`lib/normalize.ts` e `lib/format.ts` não podem importar `server-only`,
  `node:fs` nem sintaxe não-apagável** (ex.: `readonly` em parâmetro de
  construtor). São o alvo dos testes. Se precisar mover lógica pura para perto
  do I/O, o teste quebra — mantenha a separação.

## Onde a lógica mora

```
app/page.tsx  ──►  <Dashboard>  ──► useSWR(120s) ──► /api/insights
   (server,                (client)                      │
    force-dynamic)                                       ▼
                                              lib/meta.ts (5 fetch paralelos)
                                                         │
                                              lib/normalize.ts (puro, testado)
```

- **`lib/normalize.ts` / `lib/format.ts`** — puros, sem rede. Toda a lógica que
  erra silenciosamente números mora aqui, e é o que os testes cobrem.
- **`lib/meta.ts`** — cliente da Graph API: versão, token, `appsecret_proof`,
  cache, paginação, classificação de erro. `server-only`.
- **`lib/credentials.ts`** — de onde vem a credencial (abaixo).
- **`app/api/insights/route.ts`** — endpoint único do painel.
- **`app/api/settings/route.ts`** — lê estado mascarado, valida na Meta, grava.

`components/ui/` é gerado pelo shadcn; o que é deste projeto está em
`components/dashboard/`.

## Credenciais

Precedência: **variáveis de ambiente vencem sempre**, senão
`.meta-credentials.json` na raiz (modo `0600`, no `.gitignore`), gravado pela
tela de configuração. Quando o env define um campo, `lockedByEnv()` marca e a
tela desabilita — formulário web não sobrescreve o que a plataforma define.

O token nunca vai ao browser: só `mask()` atravessa o fio. Gravar pela tela é
liberado em dev; em build de produção exige `ALLOW_REMOTE_SETTINGS=1`. Esse
portão olha `NODE_ENV`, **não** o header `Host` — `Host` vem do cliente e seria
falsificável.

`app/page.tsx` tem `export const dynamic = "force-dynamic"` porque lê estado
mutável do disco. Sem isso a home é prerenderizada no build e fica presa na tela
de setup para sempre.

## Armadilhas da API da Meta

Erros aqui não quebram nada — produzem números errados que parecem certos.

- **`spend`, não `amount_spent`.** `spend` é do período, na unidade principal da
  moeda. `amount_spent` é lifetime da conta, em centavos.
- **Não somar janelas de atribuição.** Em `actions[]`, `value` já é a soma da
  janela padrão; somar `1d_click` + `7d_click` conta duas vezes.
- **Action types se sobrepõem.** `post_engagement` já inclui `post_reaction`,
  `comment` e `link_click`. Somar tudo duplica.
- **`reach`, `frequency` e `cpp` não somam** entre linhas nem entre dias. Trocar
  de período refaz a consulta; nunca agregue no cliente.
- **Mediana, não média**, no limiar de alerta: um CPM de R$157 arrasta a média
  sozinho.
- **Não enviar `action_attribution_windows` nem `use_unified_attribution_setting`** —
  desde 06/2025 a API ignora e usa a configuração do ad set. Aceitar o padrão é
  o que faz bater com o Gerenciador.
- **`thumbnail_url` sai em 64px** sem `thumbnail_width`/`thumbnail_height`, e é
  URL de CDN assinada que caduca em horas. Nunca persista; trate `onError`.
- **Batch requests não economizam cota** — cada sub-requisição conta separado.
  Poupa round-trip, não chamada. Por isso são 5 `fetch` paralelos.
- **Breakdown por hora não combina** com `reach`, `frequency`, métricas de vídeo
  nem com plataforma/posicionamento. Está fora de propósito.
- **`purchase_roas` vem vazio** sem evento de compra no pixel — não é bug. O
  painel avisa em vez de mostrar zero.
- **Rankings retornam `UNKNOWN` abaixo de 500 impressões** — significa dados
  insuficientes, não desempenho ruim.
- **Erro 190/102/200 é fatal** (token morto, exige ação); 4/17/613/80004 é rate
  limit e passa sozinho. `MetaError.fatal` carrega essa distinção e o SWR não
  re-tenta os fatais.

## Atualização

O cliente busca a cada 120s (`REFRESH_MS` em `components/dashboard/dashboard.tsx`);
o servidor passa `REVALIDATE = 300` a cada `fetch` (`lib/meta.ts`). A diferença
é deliberada: a Meta só recalcula insights a cada ~15 min, então a tela pulsa
como pedido enquanto o cache do Next absorve a maioria dos ticks. Não "conserte"
alinhando os dois. Criativos ficam em cache por 1h (`REVALIDATE_CREATIVES`).

## Regras visuais

- **Vermelho (`--v4`, `text-destructive`) é a única cor, e significa uma coisa
  só: este criativo está caro** (≥2× a mediana do custo por resultado). Não
  existe verde de "bom" — saudável é branco. Um par verde/vermelho espalhado por
  quarenta células treina o olho a ignorar os dois.
- **Todo número usa `.tnum`** (JetBrains Mono, tabular) para as colunas de
  dinheiro alinharem na vírgula. Texto usa Archivo.
- **Formatadores de `lib/format.ts`, sempre.** Devolvem `—` para `null`, e a
  distinção entre "sem dado" e zero é significativa no painel.
- O único movimento é o componente `<Num>`, que pisca quando o valor muda no
  refresh. Respeita `prefers-reduced-motion`.
- Tema escuro por compromisso, sem alternador: os tokens ficam direto no `:root`
  de `app/globals.css`.

## Verificação sem token

As rotas alcançam a Graph API de verdade, então dá para exercitar os caminhos de
erro sem credencial válida:

```bash
curl -s -X POST localhost:3000/api/settings -H 'content-type: application/json' \
  -d '{"accessToken":"EAAinvalido"}'      # 400 + código 190 real da Meta
curl -s localhost:3000/api/insights?preset=last_7d
```

Para inspeção visual sem dados reais, crie um `app/preview/page.tsx` temporário
que monte os componentes com fixtures de `lib/normalize.ts` — e apague depois.
