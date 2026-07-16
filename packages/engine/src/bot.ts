// Bot heurístico de referência.
//
// Decide via a MESMA interface pública que um humano usa (legalPredictions,
// legalPlays) e só enxerga o que playerView(state, seat) exporia. Todo helper
// daqui para baixo recebe PlayerView, nunca PartidaState — assim não há como
// espiar a mão alheia por acidente: o `state` não existe no escopo onde a
// heurística vive.
//
// Determinístico por construção: nenhum rng, nenhum Math.random. Mesmo estado,
// mesma decisão.
//
// Três regras do Previsão moldam tudo o que vem abaixo:
//  1. Não há obrigação de seguir naipe.
//  2. Naipe é irrelevante entre não-trunfos (sem trunfo na mesa, vence a maior).
//  3. Baralho duplo → cartas idênticas existem; empate → vence quem jogou antes.
// Juntas, elas dão uma ORDEM TOTAL sobre as cartas (cardStrength). É por isso
// que este bot é bem mais simples que um bot de jogo de vaza convencional.

import { buildDeck, sameCard, SUITS } from "./cards.js";
import {
  legalPlays,
  legalPredictions,
  playerView,
  type PartidaAction,
  type PartidaState,
  type PlayerView,
} from "./partida.js";
import { highHitBonus, roundScore } from "./scoring.js";
import { playOrderForTrick } from "./seating.js";
import { isTrump, resolveTrickIndex } from "./trick.js";
import type { Card, Suit } from "./types.js";

// --- Opções ---------------------------------------------------------------
export interface BotOptions {
  // Distorce o nº efetivo de oponentes na fase de previsão. É o ÚNICO
  // parâmetro não derivado das regras — todo o resto sai do regulamento ou do
  // PlayerView. 1 = o modelo uniforme puro, que é auto-consistente (a soma das
  // previsões da mesa dá ~tricks). Acima de 1 = mais pessimista/conservador.
  // Ver test/bot.test.ts, "calibração".
  readonly handSizeFactor?: number;
}

// 1.3 saiu de varredura empírica (6 e 11 jogadores, 25/12 partidas por ponto,
// sementes fixas): a curva de pontos/rodada é ACHATADA entre 1.1 e 1.5, com pico
// em 1.3 para 6 jogadores (4.51) e a 0.8% do pico para 11 (4.94 vs 4.98 em 1.1).
// A diferença entre vizinhos é da ordem do ruído (~0.05) — não vale perseguir.
//
// Por que o ótimo fica ACIMA do modelo uniforme puro (1.0)? Porque o payoff
// cresce com a previsão (valor da rodada + previsão), então o argmax de EV já
// puxa para cima; um pessimismo leve compensa esse viés. E a trava do PÉ garante
// que alguém erra de qualquer jeito.
export const DEFAULT_BOT_OPTIONS: Required<BotOptions> = { handSizeFactor: 1.3 };

function resolveOptions(options?: BotOptions): Required<BotOptions> {
  return { ...DEFAULT_BOT_OPTIONS, ...options };
}

// --- Força da carta -------------------------------------------------------
// Trunfo salta acima de qualquer carta comum; entre iguais em naipe-classe,
// decide o rank. O salto só precisa ser maior que o maior rank (14).
export const TRUMP_BOOST = 100;

export function cardStrength(card: Card, trump: Suit | null): number {
  return card.rank + (trump !== null && isTrump(card, trump) ? TRUMP_BOOST : 0);
}

// --- Pool de cartas não vistas -------------------------------------------
const poolKey = (card: Card): string => `${card.suit}-${card.rank}`;

// Baralho − própria mão − tudo que já caiu na rodada.
//
// APROXIMAÇÃO ACEITA: o pool ainda contém o estoque não distribuído (com 6
// jogadores na rodada 6 são ~67 cartas), então não é a mão de ninguém — é uma
// proxy da distribuição dela. A carta virada do trunfo também fica no pool
// (~1/100), o que é desprezível.
export function unseenPool(view: PlayerView): Card[] {
  // Remoção por MULTICONJUNTO: o baralho é duplo, então tirar "o 5 de copas"
  // precisa tirar UMA instância. Um filter(!sameCard) tiraria as duas cópias —
  // bug silencioso que só apareceria como previsão levemente errada.
  const toRemove = new Map<string, number>();
  const bump = (card: Card): void => {
    const k = poolKey(card);
    toRemove.set(k, (toRemove.get(k) ?? 0) + 1);
  };
  for (const card of view.yourHand) bump(card);
  // playedThisRound JÁ INCLUI a vaza atual — somar currentTrick aqui
  // descontaria as mesmas cartas duas vezes.
  for (const card of view.playedThisRound) bump(card);

  const out: Card[] = [];
  for (const card of buildDeck()) {
    const k = poolKey(card);
    const pending = toRemove.get(k) ?? 0;
    if (pending > 0) {
      toRemove.set(k, pending - 1);
      continue;
    }
    out.push(card);
  }
  return out;
}

// Cartas do pool que batem a minha ESTRITAMENTE.
// O `>` (e não `>=`) é a regra do baralho duplo, e vale nos dois sentidos:
// quem joga depois de mim precisa ser estritamente maior para me bater, e eu
// preciso ser estritamente maior para bater a mesa. Não "conserte" para `>=`.
function countBeating(pool: readonly Card[], card: Card, trump: Suit | null): number {
  const mine = cardStrength(card, trump);
  let n = 0;
  for (const other of pool) {
    if (cardStrength(other, trump) > mine) n++;
  }
  return n;
}

// Probabilidade de UMA carta desconhecida bater a minha.
function pBeatByOne(pool: readonly Card[], card: Card, trump: Suit | null): number {
  if (pool.length === 0) return 0;
  return countBeating(pool, card, trump) / pool.length;
}

// Probabilidade de um oponente com `h` cartas me bater NESTA vaza.
//
// Cuidado com a tentação de usar "ele joga a melhor das h cartas" (1−(1−p)^h)
// direto: isso só vale se ele CONTESTA a vaza, e ele não pode contestar todas —
// as h cartas dele serão jogadas uma em cada vaza. Modelamos a vontade de
// contestar por need/h: quem precisa de 3 vazas e tem 6 cartas contesta ~metade.
//
//   contesta  → joga a melhor  → me bate se QUALQUER carta dele for melhor
//   descarta  → joga a pior    → só me bate se TODAS forem melhores
//
// Com h=1 os dois ramos colapsam em p, seja qual for o need — como tem que ser.
function pBeatByOpponent(p: number, handSize: number, need: number): number {
  if (handSize <= 0) return 0;
  const contest = Math.min(1, Math.max(0, need / handSize));
  const ifContests = 1 - Math.pow(1 - p, handSize);
  const ifDumps = Math.pow(p, handSize);
  return contest * ifContests + (1 - contest) * ifDumps;
}

// Modelo uniforme: contra uma vaza qualquer, a carta do oponente é ~um sorteio
// da mão dele, porque ao longo da rodada ele joga cada carta exatamente uma vez.
//
// É o modelo certo para avaliar a MÃO (previsão e vazas futuras), e tem a
// propriedade que o valida: somado sobre todos os jogadores da mesa, Σ pWin dá
// exatamente `tricks` — cada vaza tem um vencedor só. Usar "melhor de h" aqui
// contaria o oponente como se ele gastasse a melhor carta em toda vaza, e
// esmagaria a previsão (na rodada 10 o expoente virava 27,5 em vez de 5).
function pWinUniform(p: number, opponents: number): number {
  return Math.pow(1 - p, opponents);
}

// --- pWin -----------------------------------------------------------------
// Assentos que ainda jogam DEPOIS de mim nesta vaza.
function opponentsYetToPlay(view: PlayerView): number[] {
  const order = playOrderForTrick(view.round, view.trickNumber, view.numPlayers);
  return order.slice(view.currentTrick.length + 1);
}

// pWin no contexto da vaza atual: a carta precisa (a) ganhar a mesa como ela
// está e (b) sobreviver a quem ainda vai jogar.
function pWinInContext(view: PlayerView, card: Card, pool: readonly Card[]): number {
  if (view.trump === null) return 0;

  // NUNCA reimplemente a comparação de cartas: delegar a resolveTrickIndex faz
  // o bot e o redutor concordarem sobre o empate por construção. Funciona igual
  // para o puxador (currentTrick vazio → índice 0), então é um caminho só.
  const hypothetical = [...view.currentTrick, { seat: view.yourSeat, card }];
  if (resolveTrickIndex(hypothetical, view.trump) !== hypothetical.length - 1) return 0;

  const p = pBeatByOne(pool, card, view.trump);
  let survives = 1;
  for (const seat of opponentsYetToPlay(view)) {
    const need = (view.predictions[seat] ?? 0) - (view.tricksWon[seat] ?? 0);
    survives *= 1 - pBeatByOpponent(p, view.handCounts[seat] ?? 0, need);
  }
  return survives;
}

// pWin genérico: "se eu puxasse esta carta numa vaza futura qualquer". Usado
// para avaliar o RESTO da mão, onde não há mesa para consultar. Uniforme, pelo
// mesmo motivo da previsão.
function pWinGeneric(view: PlayerView, card: Card, pool: readonly Card[]): number {
  const p = pBeatByOne(pool, card, view.trump);
  let opponents = 0;
  for (let seat = 0; seat < view.numPlayers; seat++) {
    if (seat !== view.yourSeat && (view.handCounts[seat] ?? 0) > 0) opponents++;
  }
  return pWinUniform(p, opponents);
}

// pWin na fase de previsão: não há mesa nem previsões alheias, só a mão.
// handSizeFactor distorce o nº efetivo de oponentes; 1 = o modelo uniforme puro.
function pWinForPrediction(
  view: PlayerView,
  card: Card,
  pool: readonly Card[],
  opts: Required<BotOptions>,
): number {
  const p = pBeatByOne(pool, card, view.trump);
  return pWinUniform(p, (view.numPlayers - 1) * opts.handSizeFactor);
}

// --- Distribuição de vazas (Poisson-binomial) -----------------------------
// D[k] = probabilidade de fazer exatamente k vazas, dadas as probabilidades
// individuais de cada carta vencer a sua vaza.
//
// A estrutura é exata (cada carta é jogada exatamente uma vez, então
// vazas = nº de cartas minhas que vencem). A APROXIMAÇÃO é supor as cartas
// independentes entre si — padrão em bots de Oh Hell.
export function trickDistribution(probs: readonly number[]): number[] {
  let dist = [1];
  for (const p of probs) {
    const next = new Array<number>(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      const d = dist[k]!;
      next[k] = next[k]! + d * (1 - p);
      next[k + 1] = next[k + 1]! + d * p;
    }
    dist = next;
  }
  return dist;
}

// --- Payoff ---------------------------------------------------------------
// Quanto vale ACERTAR a previsão `prediction` numa rodada que vale `roundValue`.
// Não replica a tabela de bônus: monta um acerto sintético e pergunta ao
// scoring.ts. Se o regulamento mudar, o bot muda junto.
export function roundPayoff(prediction: number, roundValue: number): number {
  const outcome = { prediction, tricksWon: prediction, roundValue };
  return roundScore(outcome) + highHitBonus(outcome);
}

// --- Escolha determinística ----------------------------------------------
// Desempate total e estável. O critério final (índice) é obrigatório: com
// baralho duplo, DUAS CARTAS IDÊNTICAS podem estar na mesma mão, e sem ele o
// desempate não terminaria de forma definida.
function pickBestIndex(
  count: number,
  score: (i: number) => number,
  tieBreak: (i: number) => readonly number[],
): number {
  // Sem isto, score(0) abaixo rodaria com índice inexistente e estouraria lá
  // dentro, longe da causa.
  if (count <= 0) throw new Error("pickBestIndex: nada para escolher.");
  let best = 0;
  let bestScore = score(0);
  let bestTie = tieBreak(0);
  for (let i = 1; i < count; i++) {
    const s = score(i);
    const t = tieBreak(i);
    if (s > bestScore + 1e-12) {
      best = i;
      bestScore = s;
      bestTie = t;
      continue;
    }
    if (s < bestScore - 1e-12) continue;
    // empate no score → primeiro critério de desempate que diferir
    for (let k = 0; k < t.length; k++) {
      const a = t[k]!;
      const b = bestTie[k]!;
      if (a === b) continue;
      if (a < b) {
        best = i;
        bestScore = s;
        bestTie = t;
      }
      break;
    }
  }
  return best;
}

// legalPlays devolve uma SUBSEQUÊNCIA da mão (é um filter que preserva ordem),
// então casar por dois ponteiros resolve os duplicados do baralho duplo sem
// reimplementar a regra de legalidade.
function legalHandIndices(hand: readonly Card[], legal: readonly Card[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < hand.length && j < legal.length; i++) {
    if (sameCard(hand[i]!, legal[j]!)) {
      out.push(i);
      j++;
    }
  }
  return out;
}

// --- API pública ----------------------------------------------------------
// pWin de cada carta da mão, na ótica da previsão. Fonte única para
// expectedTricks (que soma) e chooseBotPrediction (que joga na Poisson-binomial)
// — o modelo de previsão vive num lugar só.
function handWinProbabilities(view: PlayerView, opts: Required<BotOptions>): number[] {
  const pool = unseenPool(view); // caro (reconstrói o baralho): fora do laço
  return view.yourHand.map((card) => pWinForPrediction(view, card, pool, opts));
}

// Vazas esperadas para a mão atual (soma dos pWin). Exposto para teste e UI.
export function expectedTricks(view: PlayerView, options?: BotOptions): number {
  return handWinProbabilities(view, resolveOptions(options)).reduce((a, b) => a + b, 0);
}

// Previsão por argmax de VALOR ESPERADO, não por round(Σ pWin).
//
// round(Σ pWin) maximizaria a taxa de acerto, que é a métrica errada: o
// regulamento paga (valor da rodada + previsão) no acerto, MAIS bônus de alta
// em previsão >= 4. Na rodada 10, acertar 3 paga 13 e acertar 4 paga 18 — um
// degrau que a soma arredondada não enxerga.
//
// A trava do PÉ não precisa de tratamento especial: ela já vem embutida em
// legalPredictions, e o argmax só percorre o que é legal.
export function chooseBotPrediction(
  state: PartidaState,
  seat: number,
  options?: BotOptions,
): number {
  const legal = legalPredictions(state, seat);
  if (legal.length === 0) {
    throw new Error(`Bot não tem previsão a fazer no assento ${seat} (fase: ${state.phase}).`);
  }
  const view = playerView(state, seat);
  const dist = trickDistribution(handWinProbabilities(view, resolveOptions(options)));
  // Empate no EV → previsão mais baixa (menos variância, e a assimetria do
  // payoff favorece a segurança).
  const idx = pickBestIndex(
    legal.length,
    (i) => (dist[legal[i]!] ?? 0) * roundPayoff(legal[i]!, view.roundValue),
    (i) => [legal[i]!],
  );
  return legal[idx]!;
}

// Escolha da carta. Com a previsão já travada, maximizar EV É maximizar a
// probabilidade de acertar — então não há árvore de casos ("preciso de vaza" /
// "não preciso" / "já furei"): todos caem desta fórmula.
//
//   pHit(c) = pWin(c) × P(resto faz need−1) + (1 − pWin(c)) × P(resto faz need)
//
// need = 0        → D[−1] = 0 → maximiza (1−pWin) × D[0]: descarta fraca E
//                   preserva a mão fraca para as vazas seguintes.
// need < 0 (furou)→ tudo 0 → empate → menor cardStrength: descarta a mais fraca.
// need >= restante→ escolhe a mais forte QUANDO pode ganhar; se a mesa já está
//                   perdida todo pWin é 0 → empate → descarta a mais fraca, em
//                   vez de queimar o trunfo alto numa vaza perdida.
export function chooseBotPlay(state: PartidaState, seat: number, options?: BotOptions): Card {
  const legal = legalPlays(state, seat);
  if (legal.length === 0) {
    throw new Error(`Bot não tem carta a jogar no assento ${seat} (fase: ${state.phase}).`);
  }
  const view = playerView(state, seat);
  const pool = unseenPool(view);
  const hand = view.yourHand;
  const need = (view.predictions[seat] ?? 0) - (view.tricksWon[seat] ?? 0);

  const generic = hand.map((card) => pWinGeneric(view, card, pool));
  const candidates = legalHandIndices(hand, legal);

  const pHit = (handIdx: number): number => {
    const pw = pWinInContext(view, hand[handIdx]!, pool);
    const rest = generic.filter((_, k) => k !== handIdx);
    const dist = trickDistribution(rest);
    return pw * (dist[need - 1] ?? 0) + (1 - pw) * (dist[need] ?? 0);
  };

  const pick = pickBestIndex(
    candidates.length,
    (i) => pHit(candidates[i]!),
    (i) => {
      const card = hand[candidates[i]!]!;
      return [cardStrength(card, view.trump), SUITS.indexOf(card.suit), candidates[i]!];
    },
  );
  return hand[candidates[pick]!]!;
}

// Ação completa para o assento. NÃO declara "Quem tem Põe" (simplificação de
// base, CLAUDE.md §6) — o campo é omitido, nunca setado como false.
// O "deal" não sai daqui: quem tem o rng é o controlador.
export function chooseBotAction(
  state: PartidaState,
  seat: number,
  options?: BotOptions,
): PartidaAction {
  switch (state.phase) {
    case "predicting":
      return { type: "predict", seat, value: chooseBotPrediction(state, seat, options) };
    case "playing":
      return { type: "play", seat, card: chooseBotPlay(state, seat, options) };
    default:
      throw new Error(`Bot não tem ação na fase "${state.phase}".`);
  }
}
