// Protótipo single-player: um humano contra bots, com informação oculta.
//
// O motor é a fonte da verdade — esta app só (a) executa o que não é do humano
// e (b) desenha o playerView do assento dele. Nenhuma regra vive aqui.

import {
  beginNextPartida,
  canDeclareQuemTemPoeNow,
  chooseBotAction,
  createNight,
  currentPlayerSeat,
  currentPredictorSeat,
  legalPlays,
  legalPredictions,
  makeDeal,
  nightAction,
  partialStandings,
  playerView,
  resolveTrickSeat,
  type Card,
  type NightState,
  type PartidaAction,
  type Play,
} from "@previsao/engine";
import { render, type LastTrick } from "./render.js";

const HUMAN = "Você";
const ROSTER = [HUMAN, "Bia", "Caio", "Dora", "Elis", "Fábio"];

// Ritmo da mesa. Vale a pena ter os dois separados: ler uma carta nova é rápido,
// mas ler a vaza fechada inteira e quem levou pede um tempo a mais.
const BOT_DELAY_MS = 1500; // entre jogadas/previsões dos bots
const TRICK_END_PAUSE_MS = 2200; // com a vaza completa na mesa, antes de limpar

let night: NightState = createNight(ROSTER);
let timer: number | null = null;
let declareQuemTemPoe = false;

// O motor resolve a vaza e limpa currentTrick na MESMA ação, então a carta que
// fecha a vaza nunca chegaria a ser desenhada. Guardamos a vaza completa aqui
// só para exibi-la durante a pausa — quem decide o vencedor continua sendo o
// motor (resolveTrickSeat), não esta app.
let lastTrick: LastTrick | null = null;

// O assento do humano MUDA a cada partida por causa do re-assento por bruta.
function humanSeat(): number {
  return night.seating.indexOf(HUMAN);
}

// Despacha uma ação e, se ela fechou a vaza, segura a vaza completa para exibir.
// Devolve a pausa adequada ao que acabou de acontecer.
function dispatch(action: PartidaAction): number {
  const before = night.partida!;
  const trickBefore = before.currentTrick.slice();
  const trump = before.trump;

  night = nightAction(night, action);

  const fechouAVaza =
    action.type === "play" && trickBefore.length === before.numPlayers - 1 && trump !== null;

  if (fechouAVaza) {
    const plays: Play[] = [...trickBefore, { seat: action.seat, card: action.card }];
    lastTrick = { plays, winner: resolveTrickSeat(plays, trump), trump };
    return TRICK_END_PAUSE_MS;
  }
  if (action.type === "play") lastTrick = null; // nova vaza começou
  return BOT_DELAY_MS;
}

// Executa automaticamente tudo que não é decisão do humano (deal, bots,
// início de partida) e para assim que a vez for dele.
function advance(): void {
  if (night.phase === "nightComplete") return draw();

  if (night.phase === "awaitingPartida") {
    night = beginNextPartida(night, Math.random);
    lastTrick = null;
    return schedule(BOT_DELAY_MS);
  }

  const partida = night.partida!;

  if (partida.phase === "awaitingDeal") {
    // a aleatoriedade vive aqui, fora do redutor
    const deal = makeDeal(partida.numPlayers, partida.config, Math.random);
    night = nightAction(night, { type: "deal", ...deal });
    lastTrick = null;
    return schedule(BOT_DELAY_MS);
  }

  const seat =
    partida.phase === "predicting" ? currentPredictorSeat(partida) : currentPlayerSeat(partida);

  if (seat === null || seat === humanSeat()) return draw(); // a vez é sua

  return schedule(dispatch(chooseBotAction(partida, seat)));
}

// Desenha, espera, e só então segue. Limpar lastTrick aqui garante que a vaza
// fique visível exatamente durante a pausa — nem menos, nem até a jogada seguinte.
function schedule(delay: number): void {
  draw();
  if (timer !== null) clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    lastTrick = null;
    advance();
  }, delay);
}

// --- Ações do humano ------------------------------------------------------
function humanPredict(value: number): void {
  schedule(dispatch({ type: "predict", seat: humanSeat(), value }));
}

function humanPlay(card: Card): void {
  const seat = humanSeat();
  const action: PartidaAction = declareQuemTemPoe
    ? { type: "play", seat, card, declareQuemTemPoe: true }
    : { type: "play", seat, card };
  declareQuemTemPoe = false;
  schedule(dispatch(action));
}

function toggleQuemTemPoe(): void {
  declareQuemTemPoe = !declareQuemTemPoe;
  draw();
}

function restart(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  declareQuemTemPoe = false;
  lastTrick = null;
  night = createNight(ROSTER);
  advance();
}

// --- Desenho --------------------------------------------------------------
function draw(): void {
  const seat = humanSeat();
  const partida = night.partida;
  const view = partida ? playerView(partida, seat) : null;
  const yourTurn = Boolean(view && partida && view.toAct === seat);

  // Tudo que é legal vem do MOTOR — nenhuma regra é reimplementada aqui.
  const plays = yourTurn && view!.phase === "playing" ? legalPlays(partida!, seat) : [];

  // Declarar "Quem tem Põe" exige PUXAR TRUNFO: com a declaração ligada, só as
  // cartas que a permitem ficam clicáveis, senão o motor rejeitaria a jogada.
  const declarable = plays.filter((c) => canDeclareQuemTemPoeNow(partida!, seat, c));

  render(document.getElementById("app")!, {
    view,
    night,
    lastTrick,
    humanId: HUMAN,
    standings: partialStandings(night),
    legalPredictions:
      yourTurn && view!.phase === "predicting" ? legalPredictions(partida!, seat) : [],
    legalPlays: declareQuemTemPoe ? declarable : plays,
    canDeclare: declarable.length > 0,
    declareQuemTemPoe,
    onPredict: humanPredict,
    onPlay: humanPlay,
    onToggleQuemTemPoe: toggleQuemTemPoe,
    onRestart: restart,
  });
}

advance();
