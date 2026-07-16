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
  type Card,
  type NightState,
} from "@previsao/engine";
import { render } from "./render.js";

const HUMAN = "Você";
const ROSTER = [HUMAN, "Bia", "Caio", "Dora", "Elis", "Fábio"];
const BOT_DELAY_MS = 650; // pausa para dar pra acompanhar o que os bots fazem

let night: NightState = createNight(ROSTER);
let timer: number | null = null;
let declareQuemTemPoe = false;

// O assento do humano MUDA a cada partida por causa do re-assento por bruta.
function humanSeat(): number {
  return night.seating.indexOf(HUMAN);
}

// Executa automaticamente tudo que não é decisão do humano (deal, bots,
// início de partida) e para assim que a vez for dele.
function advance(): void {
  if (night.phase === "nightComplete") return draw();

  if (night.phase === "awaitingPartida") {
    night = beginNextPartida(night, Math.random);
    return schedule();
  }

  const partida = night.partida!;

  if (partida.phase === "awaitingDeal") {
    // a aleatoriedade vive aqui, fora do redutor
    const deal = makeDeal(partida.numPlayers, partida.config, Math.random);
    night = nightAction(night, { type: "deal", ...deal });
    return schedule();
  }

  const seat =
    partida.phase === "predicting" ? currentPredictorSeat(partida) : currentPlayerSeat(partida);

  if (seat === null || seat === humanSeat()) return draw(); // a vez é sua

  night = nightAction(night, chooseBotAction(partida, seat));
  return schedule();
}

function schedule(): void {
  draw();
  if (timer !== null) clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    advance();
  }, BOT_DELAY_MS);
}

// --- Ações do humano ------------------------------------------------------
function humanPredict(value: number): void {
  night = nightAction(night, { type: "predict", seat: humanSeat(), value });
  schedule();
}

function humanPlay(card: Card): void {
  const seat = humanSeat();
  const action = declareQuemTemPoe
    ? ({ type: "play", seat, card, declareQuemTemPoe: true } as const)
    : ({ type: "play", seat, card } as const);
  night = nightAction(night, action);
  declareQuemTemPoe = false;
  schedule();
}

function toggleQuemTemPoe(): void {
  declareQuemTemPoe = !declareQuemTemPoe;
  draw();
}

function restart(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  declareQuemTemPoe = false;
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
