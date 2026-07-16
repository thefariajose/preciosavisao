// Máquina de estados de uma PARTIDA (10 rodadas).
// É um redutor puro: applyAction(state, action) -> novo state. Nenhuma
// aleatoriedade e nenhum efeito colateral vivem aqui — o embaralhamento é
// feito fora (makeDeal) e entra como payload da ação "deal". Isso mantém o
// redutor 100% determinístico e testável, e serve tanto ao servidor
// autoritativo quanto ao espelho no cliente.

import { buildDeck, sameCard, shuffle } from "./cards.js";
import { roundConfig, ROUNDS, assertPlayerCount } from "./dealing.js";
import {
  playOrderForTrick,
  predictionOrder,
} from "./seating.js";
import { isValidPrediction } from "./prediction.js";
import {
  canDeclareQuemTemPoe,
  isLegalPlayUnderQuemTemPoe,
  isTrump,
  resolveTrickSeat,
} from "./trick.js";
import { computePartida } from "./scoring.js";
import type {
  Card,
  PartidaPlayerResult,
  Play,
  RoundConfig,
  RoundOutcome,
  Suit,
} from "./types.js";

export type Phase =
  | "awaitingDeal"
  | "predicting"
  | "playing"
  | "partidaComplete";

export interface PartidaState {
  readonly numPlayers: number;
  readonly seats: readonly string[]; // assento -> id do jogador (fixo na partida)
  round: number; // 1..10
  config: RoundConfig;
  phase: Phase;
  trump: Suit | null;
  hands: Card[][]; // hands[seat] = cartas restantes (informação completa)
  predictions: (number | null)[]; // por assento, na rodada atual
  predictionTurnIdx: number; // índice em predictionOrder
  tricksWon: number[]; // por assento, na rodada atual
  trickNumber: number; // 1..tricks (0 fora da fase de vaza)
  currentTrick: Play[]; // jogadas da vaza atual, em ordem
  playedThisRound: Card[]; // cartas já jogadas na rodada, inclusive a vaza atual
  quemTemPoe: boolean; // declarado para a vaza atual
  outcomes: RoundOutcome[][]; // outcomes[seat] = rodadas concluídas
  result: PartidaPlayerResult[] | null; // preenchido em partidaComplete
}

export type PartidaAction =
  | { type: "deal"; hands: Card[][]; trump: Suit }
  | { type: "predict"; seat: number; value: number }
  | { type: "play"; seat: number; card: Card; declareQuemTemPoe?: boolean };

// --- Criação --------------------------------------------------------------
export function createPartida(seats: readonly string[]): PartidaState {
  assertPlayerCount(seats.length);
  const numPlayers = seats.length;
  return {
    numPlayers,
    seats: seats.slice(),
    round: 1,
    config: roundConfig(1, numPlayers),
    phase: "awaitingDeal",
    trump: null,
    hands: Array.from({ length: numPlayers }, () => []),
    predictions: Array.from({ length: numPlayers }, () => null),
    predictionTurnIdx: 0,
    tricksWon: Array.from({ length: numPlayers }, () => 0),
    trickNumber: 0,
    currentTrick: [],
    playedThisRound: [],
    quemTemPoe: false,
    outcomes: Array.from({ length: numPlayers }, () => []),
    result: null,
  };
}

// Embaralha e reparte para a rodada atual. Impuro só por causa do rng — vive
// fora do redutor de propósito. A carta do trunfo é virada e sai da rodada.
export function makeDeal(
  numPlayers: number,
  config: RoundConfig,
  rng: () => number = Math.random,
): { hands: Card[][]; trump: Suit } {
  const deck = shuffle(buildDeck(), rng);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  let k = 0;
  for (let n = 0; n < config.cardsDealt; n++) {
    for (let seat = 0; seat < numPlayers; seat++) {
      hands[seat]!.push(deck[k++]!);
    }
  }
  const flipped = deck[k++]!; // carta virada define o trunfo e sai do jogo
  return { hands, trump: flipped.suit };
}

// --- Consultas (úteis para UI e bots) ------------------------------------
export function currentPredictorSeat(state: PartidaState): number | null {
  if (state.phase !== "predicting") return null;
  const order = predictionOrder(state.round, state.numPlayers);
  return order[state.predictionTurnIdx] ?? null;
}

export function currentPlayerSeat(state: PartidaState): number | null {
  if (state.phase !== "playing") return null;
  const order = playOrderForTrick(state.round, state.trickNumber, state.numPlayers);
  return order[state.currentTrick.length] ?? null;
}

// Previsões legais para o assento da vez (aplica a trava do PÉ).
export function legalPredictions(state: PartidaState, seat: number): number[] {
  if (currentPredictorSeat(state) !== seat) return [];
  const tricks = state.config.tricks;
  const isPe = state.predictionTurnIdx === state.numPlayers - 1;
  const sumOthers = state.predictions.reduce<number>((a, p) => a + (p ?? 0), 0);
  const all = Array.from({ length: tricks + 1 }, (_, p) => p);
  if (!isPe) return all;
  return all.filter((p) => sumOthers + p !== tricks);
}

// Cartas jogáveis pelo assento da vez (aplica a regra do "Quem tem Põe").
export function legalPlays(state: PartidaState, seat: number): Card[] {
  if (currentPlayerSeat(state) !== seat) return [];
  const hand = state.hands[seat]!;
  const isLeader = state.currentTrick.length === 0;
  if (isLeader || !state.quemTemPoe || state.trump === null) return hand.slice();
  return hand.filter((card) => isLegalPlayUnderQuemTemPoe(hand, card, state.trump!));
}

export function canDeclareQuemTemPoeNow(
  state: PartidaState,
  seat: number,
  card: Card,
): boolean {
  if (currentPlayerSeat(state) !== seat) return false;
  if (state.currentTrick.length !== 0) return false; // só o puxador
  if (state.trump === null) return false;
  return canDeclareQuemTemPoe(state.hands[seat]!, card, state.trump);
}

// --- Redutor --------------------------------------------------------------
export function applyAction(state: PartidaState, action: PartidaAction): PartidaState {
  const s: PartidaState = structuredClone(state);
  switch (action.type) {
    case "deal":
      return applyDeal(s, action);
    case "predict":
      return applyPredict(s, action);
    case "play":
      return applyPlay(s, action);
    default: {
      const _exhaustive: never = action;
      throw new Error(`Ação desconhecida: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function applyDeal(s: PartidaState, action: { hands: Card[][]; trump: Suit }): PartidaState {
  if (s.phase !== "awaitingDeal") throw new Error(`"deal" só é válido em awaitingDeal (fase: ${s.phase})`);
  if (action.hands.length !== s.numPlayers) throw new Error("Número de mãos diferente do número de jogadores.");
  for (const hand of action.hands) {
    if (hand.length !== s.config.cardsDealt) {
      throw new Error(`Cada mão deve ter ${s.config.cardsDealt} cartas nesta rodada.`);
    }
  }
  s.hands = action.hands.map((h) => h.slice());
  s.trump = action.trump;
  s.predictions = Array.from({ length: s.numPlayers }, () => null);
  s.predictionTurnIdx = 0;
  s.tricksWon = Array.from({ length: s.numPlayers }, () => 0);
  s.trickNumber = 0;
  s.currentTrick = [];
  s.playedThisRound = [];
  s.quemTemPoe = false;
  s.phase = "predicting";
  return s;
}

function applyPredict(s: PartidaState, action: { seat: number; value: number }): PartidaState {
  if (s.phase !== "predicting") throw new Error(`"predict" só é válido em predicting (fase: ${s.phase})`);
  const expected = currentPredictorSeat(s);
  if (action.seat !== expected) throw new Error(`Não é a vez do assento ${action.seat} prever (esperado: ${expected}).`);
  if (!isValidPrediction(action.value, s.config.tricks)) {
    throw new Error(`Previsão ${action.value} fora da faixa 0..${s.config.tricks}.`);
  }
  const isPe = s.predictionTurnIdx === s.numPlayers - 1;
  if (isPe) {
    const sumOthers = s.predictions.reduce<number>((a, p) => a + (p ?? 0), 0);
    if (sumOthers + action.value === s.config.tricks) {
      throw new Error(`Trava do PÉ: a soma das previsões não pode ser igual a ${s.config.tricks}.`);
    }
  }
  s.predictions[action.seat] = action.value;
  s.predictionTurnIdx += 1;
  if (s.predictionTurnIdx === s.numPlayers) {
    s.phase = "playing";
    s.trickNumber = 1;
    s.currentTrick = [];
    s.quemTemPoe = false;
  }
  return s;
}

function applyPlay(
  s: PartidaState,
  action: { seat: number; card: Card; declareQuemTemPoe?: boolean },
): PartidaState {
  if (s.phase !== "playing") throw new Error(`"play" só é válido em playing (fase: ${s.phase})`);
  const expected = currentPlayerSeat(s);
  if (action.seat !== expected) throw new Error(`Não é a vez do assento ${action.seat} jogar (esperado: ${expected}).`);
  if (s.trump === null) throw new Error("Trunfo não definido.");

  const hand = s.hands[action.seat]!;
  const cardIdx = hand.findIndex((c) => sameCard(c, action.card));
  if (cardIdx === -1) throw new Error("Carta não está na mão do jogador.");

  const isLeader = s.currentTrick.length === 0;

  if (action.declareQuemTemPoe) {
    if (!isLeader) throw new Error('"Quem tem Põe" só pode ser declarado por quem puxa a vaza.');
    if (!canDeclareQuemTemPoe(hand, action.card, s.trump)) {
      throw new Error('Para declarar "Quem tem Põe" é preciso ter trunfo e puxar um trunfo.');
    }
    s.quemTemPoe = true;
  }

  if (!isLeader && s.quemTemPoe && !isLegalPlayUnderQuemTemPoe(hand, action.card, s.trump)) {
    throw new Error('Sob "Quem tem Põe": quem tem trunfo é obrigado a jogá-lo.');
  }

  hand.splice(cardIdx, 1);
  s.currentTrick.push({ seat: action.seat, card: action.card });
  // O log da rodada sobrevive ao fim da vaza (currentTrick é limpo, este não):
  // numa mesa física todo mundo vê o que já caiu, então é informação pública e
  // vai para o PlayerView.
  s.playedThisRound.push(action.card);

  if (s.currentTrick.length === s.numPlayers) {
    const winner = resolveTrickSeat(s.currentTrick, s.trump);
    s.tricksWon[winner] = (s.tricksWon[winner] ?? 0) + 1;
    s.currentTrick = [];
    s.quemTemPoe = false;
    s.trickNumber += 1;
    if (s.trickNumber > s.config.tricks) {
      completeRound(s);
    }
  }
  return s;
}

function completeRound(s: PartidaState): void {
  for (let seat = 0; seat < s.numPlayers; seat++) {
    s.outcomes[seat]!.push({
      prediction: s.predictions[seat] ?? 0,
      tricksWon: s.tricksWon[seat] ?? 0,
      roundValue: s.config.roundValue,
    });
  }
  if (s.round < ROUNDS) {
    s.round += 1;
    s.config = roundConfig(s.round, s.numPlayers);
    s.phase = "awaitingDeal";
    s.trump = null;
    s.hands = Array.from({ length: s.numPlayers }, () => []);
    s.predictions = Array.from({ length: s.numPlayers }, () => null);
    s.predictionTurnIdx = 0;
    s.tricksWon = Array.from({ length: s.numPlayers }, () => 0);
    s.trickNumber = 0;
    s.playedThisRound = [];
  } else {
    s.result = computePartida(
      s.seats.map((id, seat) => ({ id, rounds: s.outcomes[seat]! })),
    );
    s.phase = "partidaComplete";
  }
}

// --- Redação para o cliente (esconde as mãos alheias) ---------------------
export interface PlayerView {
  readonly numPlayers: number;
  readonly seats: readonly string[];
  readonly round: number;
  readonly roundValue: number;
  readonly tricks: number;
  readonly phase: Phase;
  readonly trump: Suit | null;
  readonly yourSeat: number;
  readonly yourHand: readonly Card[];
  readonly handCounts: readonly number[]; // nº de cartas por assento
  readonly predictions: readonly (number | null)[];
  readonly tricksWon: readonly number[];
  readonly trickNumber: number;
  readonly currentTrick: readonly Play[];
  readonly playedThisRound: readonly Card[]; // público: todos veem o que já caiu
  readonly quemTemPoe: boolean;
  readonly toAct: number | null;
  readonly result: PartidaPlayerResult[] | null;
}

export function playerView(state: PartidaState, seat: number): PlayerView {
  const toAct = state.phase === "predicting" ? currentPredictorSeat(state)
    : state.phase === "playing" ? currentPlayerSeat(state)
    : null;
  return {
    numPlayers: state.numPlayers,
    seats: state.seats,
    round: state.round,
    roundValue: state.config.roundValue,
    tricks: state.config.tricks,
    phase: state.phase,
    trump: state.trump,
    yourSeat: seat,
    yourHand: (state.hands[seat] ?? []).slice(),
    handCounts: state.hands.map((h) => h.length),
    predictions: state.predictions.slice(),
    tricksWon: state.tricksWon.slice(),
    trickNumber: state.trickNumber,
    currentTrick: state.currentTrick.slice(),
    playedThisRound: state.playedThisRound.slice(),
    quemTemPoe: state.quemTemPoe,
    toAct,
    result: state.result,
  };
}
