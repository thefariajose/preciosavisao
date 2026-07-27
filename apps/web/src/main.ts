// Protótipo single-player: um humano contra bots, com informação oculta.
//
// O motor é a fonte da verdade — esta app só (a) executa o que não é do humano
// e (b) desenha o playerView do assento dele. Nenhuma regra vive aqui.

import {
  canDeclareQuemTemPoeNow,
  chooseBotAction,
  createNight,
  currentPlayerSeat,
  currentPredictorSeat,
  legalPlays,
  legalPredictions,
  makeDeal,
  MAX_PLAYERS,
  MIN_PLAYERS,
  nextSeating,
  nightAction,
  partialStandings,
  playerView,
  resolveTrickSeat,
  startPartida,
  type Card,
  type NightState,
  type PartidaAction,
  type Play,
} from "@previsao/engine";
import { render, renderSetup, type Interlude, type LastTrick } from "./render.js";

// Pool de nomes de bots. Precisa ter ao menos MAX_PLAYERS nomes: se o humano
// escolher um deles, filtramos e ainda sobram os 10 necessários para 11 mesas.
const BOT_POOL = ["Bia", "Caio", "Dora", "Elis", "Fábio", "Gil", "Hugo", "Iara", "Juca", "Lena", "Nico"];

// Ritmo da mesa. Vale a pena ter os dois separados: ler uma carta nova é rápido,
// mas ler a vaza fechada inteira e quem levou pede um tempo a mais.
// `?turbo` na URL zera as pausas — atalho para verificar telas de fim de partida
// e de campeão sem esperar a noite inteira.
const TURBO = new URLSearchParams(location.search).has("turbo");
const BOT_DELAY_MS = TURBO ? 10 : 1500; // entre jogadas/previsões dos bots
const TRICK_END_PAUSE_MS = TURBO ? 30 : 2200; // com a vaza completa, antes de limpar
const ROUND_INTERLUDE_MS = TURBO ? 30 : 4000; // fim de rodada auto-avança (com botão de pular)

// Fase da app: escolher jogadores antes de começar a noite.
let phase: "setup" | "playing" = "setup";
let humanName = "Você";
let numPlayers = 6;

// night só passa a valer em startGame; um placeholder satisfaz o tipo até lá.
let night: NightState = createNight(buildRoster("Você", 6));
let timer: number | null = null;
let declareQuemTemPoe = false;
let showHelp = false;

// O motor resolve a vaza e limpa currentTrick na MESMA ação, então a carta que
// fecha a vaza nunca chegaria a ser desenhada. Guardamos a vaza completa aqui
// só para exibi-la durante a pausa — quem decide o vencedor continua sendo o
// motor (resolveTrickSeat), não esta app.
let lastTrick: LastTrick | null = null;

// Momento de pausa (fim de rodada / fim de partida) sendo exibido. Enquanto
// setado, o fluxo espera: rodada auto-avança em ROUND_INTERLUDE_MS; partida
// espera o clique em "Próxima partida".
let interlude: Interlude | null = null;
// Assento já resolvido para a próxima partida — calculado no fim da anterior
// para que o que o overlay anuncia seja exatamente o que vai valer.
let pendingSeating: readonly string[] | null = null;

// O assento do humano MUDA a cada partida por causa do re-assento por bruta.
function humanSeat(): number {
  return night.seating.indexOf(humanName);
}

// Elenco: o humano + bots do pool, garantindo ids únicos (o motor exige).
function buildRoster(name: string, count: number): string[] {
  const bots = BOT_POOL.filter((b) => b !== name).slice(0, count - 1);
  return [name, ...bots];
}

function readNameInput(): string | null {
  const el = document.getElementById("setup-name");
  return el instanceof HTMLInputElement ? el.value : null;
}

function resetTransient(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  declareQuemTemPoe = false;
  showHelp = false;
  lastTrick = null;
  interlude = null;
  pendingSeating = null;
}

// Começa (ou reinicia) a noite com a config atual.
function startGame(): void {
  const typed = readNameInput();
  if (typed !== null) humanName = typed;
  humanName = humanName.trim() || "Você";
  night = createNight(buildRoster(humanName, numPlayers));
  phase = "playing";
  resetTransient();
  guard(advance);
}

// Volta para a tela de configuração.
function reconfigure(): void {
  resetTransient();
  phase = "setup";
  draw();
}

// Despacha uma ação. Detecta o que ela desencadeou (vaza fechada, fim de rodada,
// fim de partida) e monta o momento de pausa correspondente. Devolve a pausa em
// ms para uma vaza normal; para interlúdios devolve 0 (o schedule cuida deles).
function dispatch(action: PartidaAction): number {
  const before = night.partida!;
  const trickBefore = before.currentTrick.slice();
  const trump = before.trump;
  const roundBefore = before.round;

  night = nightAction(night, action);

  const fechouAVaza =
    action.type === "play" && trickBefore.length === before.numPlayers - 1 && trump !== null;
  const closedTrick: LastTrick | null = fechouAVaza
    ? (() => {
        const plays: Play[] = [...trickBefore, { seat: action.seat, card: action.card }];
        return { plays, winner: resolveTrickSeat(plays, trump!), trump: trump! };
      })()
    : null;

  // Partida terminou (rodada 10 fechou), mas ainda há noite → resumo + re-assento.
  if (night.partida === null && night.phase === "awaitingPartida") {
    const idx = night.partidaIndex - 1;
    pendingSeating = nextSeating(night, Math.random);
    interlude = { kind: "partida", index: idx, results: night.results[idx]!, nextSeating: pendingSeating };
    lastTrick = null;
    return 0;
  }
  // Noite terminou → a tela de campeão já é o resumo (sem interlúdio).
  if (night.phase === "nightComplete") {
    lastTrick = null;
    return 0;
  }
  // Rodada terminou, mas a partida continua → resumo da rodada + última vaza.
  if (night.partida && night.partida.round > roundBefore) {
    interlude = buildRoundInterlude(roundBefore, closedTrick);
    lastTrick = null;
    return 0;
  }
  // Vaza fechou no meio da rodada → segura a mesa por um tempo.
  if (closedTrick) {
    lastTrick = closedTrick;
    return TRICK_END_PAUSE_MS;
  }
  if (action.type === "play") lastTrick = null; // nova vaza começou
  return BOT_DELAY_MS;
}

function buildRoundInterlude(round: number, closedTrick: LastTrick | null): Interlude {
  const p = night.partida!;
  const lines = p.seats.map((id, seat) => {
    const o = p.outcomes[seat]![round - 1]!; // a rodada recém-concluída
    return { id, prediction: o.prediction, tricksWon: o.tricksWon, roundValue: o.roundValue };
  });
  return { kind: "round", round, lines, lastTrick: closedTrick };
}

// Executa automaticamente tudo que não é decisão do humano (início de partida,
// deal, bots) e para assim que a vez for dele — ou quando há um interlúdio.
function advance(): void {
  if (night.phase === "nightComplete") return draw();

  if (night.phase === "awaitingPartida") {
    // usa o assento já anunciado no fim da partida anterior; na 1ª, sorteia
    const seating = pendingSeating ?? nextSeating(night, Math.random);
    pendingSeating = null;
    night = startPartida(night, seating);
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

// Desenha, espera, e só então segue. Um interlúdio de PARTIDA espera o clique
// (não agenda timer); um de RODADA e a vaza normal auto-avançam.
function schedule(delay: number): void {
  draw();
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (interlude?.kind === "partida") return; // aguarda "Próxima partida"
  const wait = interlude ? ROUND_INTERLUDE_MS : delay;
  timer = window.setTimeout(() => {
    timer = null;
    interlude = null;
    lastTrick = null;
    guard(advance);
  }, wait);
}

// Sair de um interlúdio pelo botão (ou fim do timer): limpa e segue.
function continueFlow(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  interlude = null;
  lastTrick = null;
  guard(advance);
}

// Rede de segurança do controlador: qualquer exceção inesperada mostra um aviso
// recuperável em vez de deixar a página congelada e muda. Não deveria disparar —
// se disparar, é bug e queremos vê-lo, não escondê-lo.
function guard(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    console.error("Erro no controlador da partida:", err);
    fail(err);
  }
}

function fail(err: unknown): void {
  const app = document.getElementById("app");
  if (!app) return;
  const panel = document.createElement("section");
  panel.className = "panel end";
  const msg = err instanceof Error ? err.message : String(err);
  panel.innerHTML = `<h1>Algo saiu do trilho</h1><p class="champion">${msg}</p>`;
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Reiniciar a noite";
  btn.addEventListener("click", restart);
  panel.append(btn);
  app.replaceChildren(panel);
}

// --- Ações do humano ------------------------------------------------------
// As guardas de turno descartam cliques fora de hora — sobretudo o clique duplo
// rápido numa carta, que senão despacharia uma jogada já consumida e o motor
// rejeitaria (carta fora da mão).
function humanPredict(value: number): void {
  const partida = night.partida;
  if (!partida || currentPredictorSeat(partida) !== humanSeat()) return;
  guard(() => schedule(dispatch({ type: "predict", seat: humanSeat(), value })));
}

function humanPlay(card: Card): void {
  const partida = night.partida;
  const seat = humanSeat();
  if (!partida || currentPlayerSeat(partida) !== seat) return;
  const action: PartidaAction = declareQuemTemPoe
    ? { type: "play", seat, card, declareQuemTemPoe: true }
    : { type: "play", seat, card };
  declareQuemTemPoe = false;
  guard(() => schedule(dispatch(action)));
}

function toggleQuemTemPoe(): void {
  declareQuemTemPoe = !declareQuemTemPoe;
  draw();
}

function toggleHelp(): void {
  showHelp = !showHelp;
  draw();
}

// "Jogar de novo": repete com o mesmo elenco.
function restart(): void {
  startGame();
}

// --- Desenho --------------------------------------------------------------
function draw(): void {
  const app = document.getElementById("app")!;

  if (phase === "setup") {
    renderSetup(app, {
      name: humanName,
      count: numPlayers,
      min: MIN_PLAYERS,
      max: MAX_PLAYERS,
      roster: buildRoster(humanName.trim() || "Você", numPlayers),
      showHelp,
      onName: (v) => {
        humanName = v;
      }, // sem redraw: o input mantém foco enquanto se digita
      onCount: (n) => {
        const typed = readNameInput();
        if (typed !== null) humanName = typed; // preserva o nome ao redesenhar
        numPlayers = n;
        draw();
      },
      onStart: startGame,
      onToggleHelp: toggleHelp,
    });
    return;
  }

  const seat = humanSeat();
  const partida = night.partida;
  const view = partida ? playerView(partida, seat) : null;
  const yourTurn = Boolean(view && partida && view.toAct === seat);

  // Tudo que é legal vem do MOTOR — nenhuma regra é reimplementada aqui.
  const plays = yourTurn && view!.phase === "playing" ? legalPlays(partida!, seat) : [];

  // Declarar "Quem tem Põe" exige PUXAR TRUNFO: com a declaração ligada, só as
  // cartas que a permitem ficam clicáveis, senão o motor rejeitaria a jogada.
  const declarable = plays.filter((c) => canDeclareQuemTemPoeNow(partida!, seat, c));

  render(app, {
    view,
    night,
    lastTrick,
    interlude,
    showHelp,
    humanId: humanName,
    standings: partialStandings(night),
    legalPredictions:
      yourTurn && view!.phase === "predicting" ? legalPredictions(partida!, seat) : [],
    legalPlays: declareQuemTemPoe ? declarable : plays,
    canDeclare: declarable.length > 0,
    declareQuemTemPoe,
    onPredict: humanPredict,
    onPlay: humanPlay,
    onToggleQuemTemPoe: toggleQuemTemPoe,
    onContinue: continueFlow,
    onToggleHelp: toggleHelp,
    onRestart: restart,
    onReconfigure: reconfigure,
  });
}

draw(); // começa na tela de configuração
