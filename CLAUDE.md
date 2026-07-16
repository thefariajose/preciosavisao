# CLAUDE.md — Projeto Previsão

Contexto para o Claude Code. Este arquivo resume as regras do jogo, as decisões
já fechadas, a arquitetura e o estado atual do código. **Leia inteiro antes de
escrever qualquer coisa.** Quando houver conflito entre este documento e sua
intuição sobre "jogos de vaza em geral", **este documento vence** — o Previsão
tem particularidades próprias.

---

## 1. O que é o projeto

Implementação digital do **Previsão**, um jogo de cartas de vazas com previsão
(família "Oh Hell" / "Fodinha"), jogado por um grupo (os "Previsioneiros").

**Objetivo imediato:** um **protótipo web single-player** — um humano joga contra
**bots**, com informação oculta (o humano só vê a própria mão). Nada de hotseat:
vários no mesmo dispositivo vazaria as mãos.

**Roadmap (escalar aos poucos):**
1. Motor de regras puro e testado. ✅ **feito**
2. Máquina de estados da partida. ✅ **feito**
3. Invólucro da noite (3 partidas). ✅ **feito**
4. Bot de referência. ✅ **feito**
5. Protótipo web single-player (humano vs bots). ⏳ **próximo / em andamento**
6. Mobile (React Native / Expo) reaproveitando o motor. ⬜ depois
7. Multiplayer real (servidor autoritativo). ⬜ depois
8. Camada de temporada + persistência (Postgres). ⬜ depois

---

## 2. Stack e decisões de arquitetura

- **TypeScript de ponta a ponta.** O motor é escrito uma vez e roda no
  servidor e no cliente. Fonte única da verdade.
- **Monorepo.** `packages/engine` (motor puro), `apps/web` (protótipo, ainda a
  criar), futuramente `apps/mobile` e `server/`.
- **Web primeiro, mobile depois** (decisão do dono do projeto).
- **Motor puro, sem UI e sem rede.** Funções e redutores determinísticos.
- **Multiplayer adiado de propósito.** Quando chegar, inclinação por servidor
  autoritativo (Colyseus) por causa da informação oculta; alternativa "zero ops"
  = managed realtime (Convex/Supabase/PartyKit). Não decidir agora.
- **Camada de temporada adiada** (Postgres). Fora do protótipo.

### Princípios inegociáveis do motor
- **Redutores puros:** `applyAction(state, action) -> novo state`. Sem efeitos,
  sem aleatoriedade dentro do redutor.
- **Aleatoriedade fica fora:** o embaralhamento vive em `makeDeal(...)`, que
  recebe um `rng` injetável e entrega as mãos/trunfo como *payload* da ação
  `deal`. Isso mantém o redutor 100% determinístico e testável.
- **Informação oculta:** o estado completo tem todas as mãos; `playerView(state,
  seat)` redige a visão de cada jogador (sua mão + só as *contagens* das mãos
  alheias). É isso que o servidor mandaria a cada cliente.
- **Bots usam a interface pública de jogadas legais** (`legalPlays`,
  `legalPredictions`), como um humano. Estratégia vive separada das regras.

---

## 3. Regras do jogo (completas)

### Baralho e mesa
- **Baralho duplo: 2 × 52 = 104 cartas.** Existem cartas idênticas (mesmo valor
  E mesmo naipe) — isso é essencial e gera a regra de desempate por ordem.
- **6 a 11 jogadores.**
- Hierarquia: **A > K > Q > J > 10 > 9 > ... > 2** (Ás alto, 2 baixo).
- Naipes: `ouros`, `espadas`, `copas`, `paus`.
- **10 rodadas.** Rodada N distribui N cartas por jogador (Rodada 1 = 1 carta …
  Rodada 10 = 10 cartas).
- **Trunfo:** após embaralhar e **antes** das previsões, vira-se 1 carta que
  define o naipe trunfo da rodada. Essa carta sai do jogo. Trunfo vence qualquer
  naipe comum; entre trunfos, vence o maior.

### Fase de previsão
- Ordem: começa no **MÃO** (ficha vermelha), segue no **sentido horário**,
  termina no **PÉ**.
- Cada um prevê de **0 até o nº de vazas** da rodada.
- **Trava do PÉ:** a soma de TODAS as previsões **não pode ser igual ao nº de
  vazas**. O PÉ é obrigado a ajustar. (Garante que sempre haja ao menos um erro.)

### Fase de vazas
- **Não há obrigação de seguir naipe** — pode-se jogar qualquer carta.
- **Vencedor da vaza:** se há trunfo na mesa, vence o maior trunfo; sem trunfo,
  vence a maior carta (**naipe é irrelevante entre não-trunfos**). Empate de
  valor idêntico (baralho duplo) → **vence quem jogou primeiro**.
- **"Quem tem Põe":** só o **puxador** pode declarar, e **só puxando um trunfo**
  (logo, precisa ter trunfo). Obriga todos que tenham trunfo a jogar trunfo;
  quem não tem, joga qualquer carta. Vence o maior trunfo.
- **Previsão 0:** não pode vencer nenhuma vaza. Se vencer (pode ser forçado via
  "Quem tem Põe"), **fura** e zera a rodada.

---

## 4. Nuances resolvidas (as divergências entre os dois documentos)

O projeto partiu de dois PDFs (um "Regulamento" de torneio e umas "Regras
Oficiais") que **divergiam**. Estas são as decisões já batidas — **não
reabrir**:

1. **Máximo de jogadores = 11.** (As "Regras Oficiais" diziam 10; vale 11.)
2. **Rodada 10 com 11 jogadores:** distribui **9 cartas** (9 vazas reais), mas o
   **valor da rodada continua 10** para pontuar. A trava do PÉ usa **9** (vazas
   reais), não 10.
3. **Puxada das vazas seguintes = rotação por assento**, NÃO "vencedor puxa".
   Vaza 1 puxada pelo MÃO; cada vaza seguinte é puxada pelo **próximo assento no
   sentido horário**. Independe de quem venceu a vaza anterior.
4. **Sem naipe obrigatório;** sem trunfo, a maior carta vence independentemente
   do naipe.
5. **Bônus de "alta" = por ACERTAR previsão ≥ 4** (não por prever alto sem
   acertar). Por rodada.
6. **Bônus de ≥60** usa **faixas limpas** do Regulamento (não os `>60/>61/...`).
7. **Sem placar oculto** (o placar é sempre visível).
8. **Erro de cartas:** no digital o sistema **impede** a jogada ilegal; a regra
   física de troca/refação não se aplica.
9. **Ordem de mão:** melhor colocado senta na cabeça (assento 0) e é MÃO da
   rodada 1; a ficha anda **1 assento por rodada** no horário. Com 11 jogadores
   e 10 rodadas, o assento 10 **nunca** é MÃO na partida (a ficha vai de 0 a 9).
   Com 6 jogadores a ficha dá a volta (rodada 7 volta ao assento 0).
10. **§9 do Regulamento** ("reposicionar por pontuação") **não** é por rodada —
    é o **re-assento entre as 3 partidas da noite** (ver §5).
11. **Sem "acerto em número de previsões da noite"** (esse bônus foi removido).

---

## 5. A cascata de pontuação (o coração — leia com atenção)

### Por rodada
- **Acertou** a previsão exata (vazas feitas == previsão): `valor da rodada +
  previsão`.
- **Errou** (pra mais OU pra menos): **0**.
- Previsão 0 que vence vaza → errou → 0.

### Bruta da partida
- **Bruta = soma das 10 rodadas.**
- A bruta serve **apenas** para (i) **ranquear** os jogadores na mesa e (ii)
  disparar o **bônus de ≥60**.
- ⚠️ **A BRUTA NÃO SOBE para o placar da noite.** Este é o erro mais fácil de
  cometer. Só sobem: **pontos de lugar + bônus de alta + bônus de ≥60.**

### Pontos de lugar (derivados do rank por bruta)
Tabela por colocação (1º ao 11º):

| 1º | 2º | 3º | 4º | 5º | 6º | 7º | 8º | 9º | 10º | 11º |
|----|----|----|----|----|----|----|----|----|-----|-----|
| 10 | 7  | 5  | 4  | 3  | 3  | 2  | 2  | 1  | 1   | 1   |

- **Empate no rank = competição padrão.** Dois em 3º → ambos pegam o 3º e o
  próximo é o **5º** (pula o 4º).

### Bônus de alta acertada (por rodada, cumulativo)
Só quando **acerta** uma previsão ≥ 4:

| Previsão acertada | 4 | 5 | 6 | 7+ |
|-------------------|---|---|---|----|
| Bônus             | 4 | 5 | 7 | 10 |

### Bônus por bruta ≥ 60 (faixas limpas, 1× por partida)

| Bruta | 60 | 61–65 | 66–70 | 71+ |
|-------|----|-------|-------|-----|
| Bônus | 1  | 3     | 5     | 10  |

### Contribuição da partida para a noite
`nightContribution = pontos de lugar + bônus de alta (soma das rodadas) + bônus de ≥60`

### Noite (3 partidas)
- **Elenco fixo** nas 3 partidas.
- **Placar da noite** = soma das `nightContribution` das 3 partidas.
- **Campeão** = maior total. **Empate → co-campeões, sem desempate.**

### Assentos ao longo da noite
- **Partida 1:** por **sorteio** (numa noite avulsa sem temporada; numa temporada
  real seria pela classificação do corrido — fora do escopo).
- **Partidas 2 e 3:** ordem pela **bruta da partida imediatamente anterior**
  (não pelo acumulado). Melhor bruta senta na cabeça.
- **Empate no re-assento → sorteio** (só afeta ordem de mão, não pontuação).

---

## 6. Estrutura do repositório e estado atual

```
previsao/
├─ CLAUDE.md                        (este arquivo)
└─ packages/
   └─ engine/                       @previsao/engine — motor puro (feito, 67 testes verdes)
      ├─ package.json               (vitest + typescript)
      ├─ tsconfig.json
      ├─ src/
      │  ├─ types.ts                tipos base (Card, RoundConfig, RoundOutcome, ...)
      │  ├─ cards.ts                baralho 104, ordenação, shuffle(rng)
      │  ├─ dealing.ts              agenda de rodadas, cap de 11 jog. na rodada 10
      │  ├─ seating.ts              mão por rodada, PÉ, puxada rotativa por assento
      │  ├─ trick.ts                resolução da vaza, "Quem tem Põe"
      │  ├─ prediction.ts           validação + trava do PÉ
      │  ├─ scoring.ts              cascata: rodada→bruta→rank→lugar→noite + bônus
      │  ├─ partida.ts              MÁQUINA DE ESTADOS da partida (redutor) + playerView
      │  ├─ night.ts                INVÓLUCRO da noite (3 partidas, re-assento, campeão)
      │  ├─ bot.ts                  bot heurístico de referência
      │  └─ index.ts                barrel (re-exporta tudo)
      └─ test/                      um arquivo de teste por módulo (vitest)
```

### O que está pronto e testado (67 testes)
- Motor de regras completo (cards, dealing, seating, trick, prediction, scoring).
- `partida.ts`: redutor com fases `awaitingDeal → predicting → playing →
  partidaComplete`; ações `deal | predict | play`; `makeDeal`, consultas
  (`currentPredictorSeat`, `currentPlayerSeat`, `legalPredictions`, `legalPlays`,
  `canDeclareQuemTemPoeNow`) e `playerView`. Testes incluem partidas inteiras
  auto-jogadas (6 e 11 jogadores).
- `night.ts`: `createNight`, `nextSeating`, `startPartida`, `beginNextPartida`,
  `nightAction`, `partialStandings`, `drawSeating`, `reseatByBruta`. Testes
  incluem uma noite inteira (3 partidas) auto-jogada.
- `bot.ts`: `chooseBotPrediction`, `chooseBotPlay`, `chooseBotAction`. Bots NÃO
  declaram "Quem tem Põe" (simplificação de base).

### O que NÃO existe ainda
- **`apps/web` (o protótipo single-player).** É o próximo passo.
- Qualquer UI. Nenhum servidor. Nenhuma camada de temporada.

---

## 7. Como rodar o motor

```bash
cd packages/engine
npm install
npm test          # vitest run
npm run typecheck  # tsc --noEmit
```

Convenção de import ESM: os arquivos usam extensão **`.js`** nos imports
(ex.: `import { ... } from "./cards.js"`), resolvendo para os `.ts` via
`moduleResolution: bundler`. Mantenha esse padrão.

---

## 8. Próximo passo: protótipo web single-player

Objetivo: um humano (assento do humano, localizado por id em `night.seating`)
joga contra bots, com informação oculta.

Diretrizes já combinadas:
- **Single-player, não hotseat.** O humano só vê a própria mão (`playerView`).
- Bots agem via `chooseBotAction(state, seat)`.
- Fluxo sugerido: manter `NightState` no estado da app; um "controlador" que, a
  cada mudança, executa automaticamente o que não é do humano (deal, jogadas de
  bot, re-assento) com um pequeno atraso para dar pra acompanhar; jogadas do
  humano vêm da UI. Achar o assento do humano a cada partida com
  `night.seating.indexOf(humanId)` (ele muda por causa do re-assento).
- **Direção visual (do guia de design):** ancorar no tema real do jogo — **mesa
  de feltro verde** como herói, cartas de marfim, acento de **latão/dourado**
  (luz de lâmpada). Fugir do visual "AI-padrão" (creme + serifa + terracota).
  Naipes vermelhos (ouros/copas) e escuros (espadas/paus). Um elemento
  assinatura: a pilha da vaza no centro do feltro + o medalhão do trunfo.

### Ideia de bundling do protótipo
Como o motor está em TS com imports `.js`, o caminho mais robusto é **compilar o
engine para JS** (`tsc` → `dist/`) e a app importar do `dist`, evitando atrito de
resolução `.js`→`.ts` em bundlers. Depois, Vite (dev) ou esbuild (bundle único
`.html` autocontido para jogar na hora).

---

## 9. Convenções

- **Domínio em português** (nomes de naipes, comentários, mensagens de erro).
  Código/identificadores podem misturar, mas os termos do jogo ficam em pt-BR.
- **Testes = o regulamento virado em asserção.** Cada nuance do §4/§5 tem um
  teste correspondente. Ao mexer em regra, ajuste/adicione teste.
- **Não reabrir decisões do §4** sem o dono do projeto pedir explicitamente.
- Ao adicionar módulo novo, exporte pelo `src/index.ts` (barrel).
- Sugestão: inicializar **git** no repo (hoje não há) para ter diff real por
  passo — mais confiável que timestamps.