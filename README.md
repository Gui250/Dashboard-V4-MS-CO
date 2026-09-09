# V4 Company MS&CO — Painel de Mídia

Painel de tráfego pago e performance de criativos, lendo a Marketing API da Meta
direto. Sem banco, sem worker, sem sincronização: a Meta é a fonte da verdade.

## Rodar

```bash
npm install
npm run dev
```

Abre em http://localhost:3000. Na primeira vez a tela pede o token; cole e pronto.
Não é preciso editar arquivo nenhum.

## Onde ficam as credenciais

Duas origens, nesta ordem de precedência:

1. **Variáveis de ambiente** (`META_ACCESS_TOKEN`, `META_APP_SECRET`,
   `META_AD_ACCOUNTS`, `META_API_VERSION`). Vencem sempre. É assim que se
   configura em servidor. Quando definidas, a tela fica só de leitura — um
   formulário web não deve poder sobrescrever o que a plataforma define.
2. **`.meta-credentials.json`** na raiz do projeto, gravado pela própria tela,
   com permissão `0600` e fora do Git. É o caminho de quem roda na própria máquina.

O token **nunca** vai para o `localStorage` nem para o bundle do browser. A tela
só recebe de volta uma versão mascarada (`EAAG12••••••••9876`) — o valor cheio
não trafega no sentido servidor → cliente.

Gravar credencial pela tela é liberado a partir da **própria máquina**, inclusive
em build de produção — `npm start` no seu computador não é "exposto na internet".
Requisições vindas de fora (outro dispositivo na rede, ou um deploy) precisam de
`ALLOW_REMOTE_SETTINGS=1` explícito.

A origem é lida do `x-forwarded-for`, que o Next preenche em toda requisição com
o endereço de quem conectou. Forjar o `Host` não engana, mas quem já alcança a
porta pode forjar o próprio `x-forwarded-for`. A checagem é proporcional ao
estrago possível: como o `GET` só devolve máscara, **o formulário não vaza o
token** — o pior caso é alguém sobrescrever a credencial e quebrar o painel.

> Se você publicar isto, o formulário não é a exposição que importa: o painel
> inteiro não tem autenticação, e qualquer um com a URL vê o gasto da conta.
> Ponha login na frente antes de expor, e prefira `META_ACCESS_TOKEN` no
> ambiente (a tela então fica só de leitura).

## Gerar o token da Meta

Uma vez só, ~10 minutos. O token de System User **não expira**.
O mesmo roteiro está dentro da tela de conexão, em "Como gerar o token".

1. **Criar o app** — [developers.facebook.com/apps](https://developers.facebook.com/apps)
   → *Criar app* → tipo **Empresa** → vincular ao Business Manager.
2. **Adicionar o produto** *Marketing API* ao app.
3. **Criar o System User** — [business.facebook.com/settings](https://business.facebook.com/settings)
   → *Usuários* → *Usuários do sistema* → *Adicionar* → função **Admin**.
4. **Dar acesso aos ativos** — no System User, *Adicionar ativos* → *Contas de
   anúncios* → marcar as contas → permissão **Ver desempenho** (só leitura basta).
   Se quiser os previews de anúncio, adicione também a Página e a conta do Instagram.
5. **Gerar o token** — *Gerar novo token* → escolher o app → marcar `ads_read` e
   `business_management` → **deixar desmarcada** a caixa "O token expira em 60 dias".
6. **Colar** o token na tela de conexão do painel. Ele é testado na Meta antes de
   ser gravado, e as contas de anúncio que o token enxerga são descobertas
   automaticamente — você não digita ID nenhum.

`ads_management` não é necessário: o painel só lê.

> Enquanto o app estiver em *Development tier*, a cota é menor (600 + 400 × nº de
> anúncios ativos, por hora). Para esta conta isso é folgado — o painel gasta
> ~70 chamadas/hora. Advanced Access só é preciso em escala bem maior.

## Como a atualização funciona

O painel busca a cada **2 minutos** (`refreshInterval` em `components/dashboard/dashboard.tsx`).

A Meta, porém, **recalcula insights a cada ~15 minutos** — buscar mais que isso
gasta cota pelo mesmo número. Por isso `lib/meta.ts` marca cada `fetch` com
`revalidate: 300`: o cache do Next absorve a maioria dos ticks e só ~1 em cada 3
chega à Graph API. Você vê o painel pulsando; a Meta não vê 900 chamadas/hora.

Metadados de criativo (miniaturas, nomes) mudam raramente e ficam em cache por 1 hora.

## Estrutura

| Arquivo | Papel |
|---|---|
| `lib/normalize.ts` | Lógica pura: achatar `actions[]`, escolher o resultado por objetivo, métricas de vídeo, mediana. Sem rede — é o que os testes cobrem. |
| `lib/meta.ts` | Cliente da Graph API: versão, token, `appsecret_proof`, cache, paginação, erros. |
| `lib/meta-types.ts` | Formas cruas da API e a forma normalizada que o cliente consome. |
| `app/api/insights/route.ts` | Único endpoint. Valida a conta contra a allowlist e dispara as consultas em paralelo. |
| `hooks/use-filters.ts` | Filtros na URL — link compartilhável, botão voltar funciona. |
| `lib/credentials.ts` | Origem das credenciais: ambiente vence, arquivo local como alternativa. |
| `app/api/settings/route.ts` | Lê o estado mascarado, valida na Meta e grava. |
| `components/dashboard/creative-track.tsx` | A pista de criativos. |

## Testes

```bash
npm test
```

Roda no test runner nativo do Node contra fixtures de respostas reais da conta.
Sem vitest, sem jest, sem config.

## Decisões que valem saber

- **Sem batch requests.** A documentação da Meta é explícita: cada sub-requisição
  de um batch conta separadamente para a cota. Batch pouparia round-trips, não
  chamadas. Cinco `fetch` em paralelo fazem o mesmo com menos código.
- **`spend`, não `amount_spent`.** São coisas diferentes: `spend` é do período e
  vem na unidade principal da moeda; `amount_spent` é lifetime da conta e vem em
  centavos.
- **Não somamos janelas de atribuição.** Em `actions[]`, `value` já é a soma da
  janela padrão — somar `1d_click` + `7d_click` contaria duas vezes.
- **Mediana, não média**, para o limiar de alerta: um criativo com CPM de R$157
  arrastaria a média sozinho.
- **`reach` e `frequency` não somam** entre linhas nem entre dias. Trocar de
  período refaz a consulta em vez de agregar no cliente.
- **ROAS fica vazio** em campanhas de tráfego e engajamento — só popula com
  evento de compra no pixel. O painel avisa em vez de mostrar zero.
- **Breakdown por hora ficou de fora**: a API não permite combiná-lo com alcance,
  frequência nem métricas de vídeo, e ele não combina com plataforma/posicionamento.
  A série diária cobre a mesma pergunta sem essas restrições.
