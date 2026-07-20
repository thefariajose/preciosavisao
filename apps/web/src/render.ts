// Desenho puro: recebe o que mostrar e devolve DOM. Nenhuma regra do jogo mora
// aqui — o que é legal chega pronto, vindo do motor.

import { isHit, maoSeatForRound, peSeatForRound, roundScore, type Card, type NightStanding, type NightState, type Play, type PlayerView, type RoundOutcome, type Suit } from "@previsao/engine";

// A vaza que acabou de fechar, segurada pelo controlador só para ser exibida —
// o motor já a apagou do estado no instante em que a resolveu.
export interface LastTrick {
  readonly plays: readonly Play[];
  readonly winner: number;
  // O trunfo da rodada que a vaza pertence. Guardado porque, na ÚLTIMA vaza de
  // uma rodada, o motor já zerou state.trump quando esta vaza vai ao ar — e sem
  // o trunfo não dá para entender por que um 2 bateu dois ases.
  readonly trump: Suit;
}

export interface RenderProps {
  readonly view: PlayerView | null;
  readonly night: NightState;
  readonly lastTrick: LastTrick | null;
  readonly humanId: string;
  readonly standings: readonly NightStanding[];
  readonly legalPredictions: readonly number[];
  readonly legalPlays: readonly Card[];
  readonly canDeclare: boolean;
  readonly declareQuemTemPoe: boolean;
  readonly onPredict: (value: number) => void;
  readonly onPlay: (card: Card) => void;
  readonly onToggleQuemTemPoe: () => void;
  readonly onRestart: () => void;
}

const SUIT_SYMBOL: Record<Suit, string> = {
  ouros: "♦",
  espadas: "♠",
  copas: "♥",
  paus: "♣",
};

const RANK_LABEL: Record<number, string> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const rankText = (rank: number): string => RANK_LABEL[rank] ?? String(rank);
const isRed = (suit: Suit): boolean => suit === "ouros" || suit === "copas";

function cardEl(card: Card, opts: { playable?: boolean; dimmed?: boolean } = {}): HTMLElement {
  const el = document.createElement(opts.playable ? "button" : "div");
  el.className = `card ${isRed(card.suit) ? "red" : "black"}${opts.playable ? " playable" : ""}${
    opts.dimmed ? " dimmed" : ""
  }`;
  el.innerHTML = `<span class="rank">${rankText(card.rank)}</span><span class="suit">${SUIT_SYMBOL[card.suit]}</span>`;
  return el;
}

const plural = (n: number, singular: string, plural: string): string =>
  `${n} ${n === 1 ? singular : plural}`;

function h(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function render(root: HTMLElement, p: RenderProps): void {
  const main = document.createElement("div");
  main.className = "main";
  main.append(p.night.phase === "nightComplete" ? nightEnd(p) : table(p));
  if (p.view) main.append(liveScore(p.view, p.humanId));
  root.replaceChildren(main, scoreboard(p));
}

// Placar da partida em andamento: uma linha por jogador, uma coluna por rodada.
// A bruta é derivada aqui via roundScore — a regra de pontuação continua morando
// só no motor.
function liveScore(v: PlayerView, humanId: string): HTMLElement {
  const box = h("section", "panel live");
  box.append(h("h2", "", "Placar da partida"));
  box.append(
    h("p", "muted", "Acertou a previsão exata: valor da rodada + previsão. Errou: zero."),
  );

  const rows = v.seats.map((id, seat) => {
    const rounds = v.outcomes[seat] ?? [];
    return { id, seat, rounds, bruta: rounds.reduce((sum, o) => sum + roundScore(o), 0) };
  });
  // maior bruta em cima — é o que decide o rank e os pontos de lugar
  rows.sort((a, b) => b.bruta - a.bruta);

  const t = document.createElement("table");
  t.className = "grid";

  const head = document.createElement("tr");
  head.innerHTML =
    `<th class="who">Jogador</th>` +
    Array.from({ length: 10 }, (_, i) => `<th${i + 1 === v.round ? ' class="now"' : ""}>${i + 1}</th>`).join("") +
    `<th class="bruta">Bruta</th>`;
  const thead = document.createElement("thead");
  thead.append(head);
  t.append(thead);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.id === humanId) tr.className = "you";

    const name = document.createElement("td");
    name.className = "who";
    name.textContent = row.id;
    tr.append(name);

    for (let round = 1; round <= 10; round++) {
      const td = document.createElement("td");
      const outcome = row.rounds[round - 1];
      if (outcome) {
        td.textContent = String(roundScore(outcome));
        td.className = isHit(outcome) ? "hit" : "miss";
        td.title = detail(outcome);
      } else if (round === v.round && v.phase !== "awaitingDeal") {
        // rodada em curso: mostra o que ele previu e quantas já fez
        const pred = v.predictions[row.seat];
        td.className = "now";
        td.textContent =
          pred === null || pred === undefined ? "…" : `${v.tricksWon[row.seat] ?? 0}/${pred}`;
        td.title = "Rodada em andamento (vazas feitas / previsão)";
      } else {
        td.textContent = "·";
        td.className = "future";
      }
      tr.append(td);
    }

    const bruta = document.createElement("td");
    bruta.className = "bruta";
    bruta.textContent = String(row.bruta);
    tr.append(bruta);
    body.append(tr);
  }
  t.append(body);
  box.append(t);
  return box;
}

function detail(o: RoundOutcome): string {
  const base = `previu ${o.prediction}, fez ${o.tricksWon}`;
  return isHit(o) ? `${base} → acertou: ${o.roundValue} + ${o.prediction}` : `${base} → errou: 0`;
}

function nightEnd(p: RenderProps): HTMLElement {
  const box = h("section", "panel end");
  box.append(h("h1", "", "Fim da noite"));
  const champs = p.night.champions ?? [];
  box.append(
    h(
      "p",
      "champion",
      champs.length > 1
        ? `Co-campeões: ${champs.join(", ")}`
        : `Campeão: ${champs[0] ?? "—"}`,
    ),
  );
  const again = h("button", "primary", "Jogar de novo");
  again.addEventListener("click", p.onRestart);
  box.append(again);
  return box;
}

function table(p: RenderProps): HTMLElement {
  const box = h("section", "table-view");
  const v = p.view;
  if (!v) {
    box.append(h("p", "muted", "Preparando a mesa…"));
    return box;
  }

  // na vaza que fecha a rodada o motor já zerou o trunfo — mostramos o da vaza
  const trump = v.trump ?? (v.currentTrick.length === 0 ? (p.lastTrick?.trump ?? null) : null);
  const mao = maoSeatForRound(v.round, v.numPlayers);
  const pe = peSeatForRound(v.round, v.numPlayers);

  // --- barra compacta de contexto
  const bar = h("div", "topbar");
  bar.append(h("span", "chip", `Partida ${p.night.partidaIndex + 1}/3`));
  bar.append(h("span", "chip", `Rodada ${v.round} · vale ${v.roundValue}`));
  bar.append(h("span", "chip", plural(v.tricks, "vaza", "vazas")));
  if (v.quemTemPoe) bar.append(h("span", "chip poe", "Quem tem Põe!"));
  box.append(bar);

  // --- o feltro (herói): jogadores em volta, medalhão do trunfo, pilha central
  const felt = h("div", "felt");

  if (trump) {
    const med = h("div", `medallion ${isRed(trump) ? "red" : "black"}`);
    med.innerHTML = `<span class="med-suit">${SUIT_SYMBOL[trump]}</span><span class="med-label">trunfo</span>`;
    felt.append(med);
  }

  // oponentes distribuídos num arco pelo alto do feltro (o humano fica embaixo,
  // representado pela própria mão). Ordenados por distância horária ao humano.
  const opponents = v.seats
    .map((_, seat) => seat)
    .filter((seat) => seat !== v.yourSeat)
    .sort(
      (a, b) =>
        ((a - v.yourSeat + v.numPlayers) % v.numPlayers) -
        ((b - v.yourSeat + v.numPlayers) % v.numPlayers),
    );

  opponents.forEach((seat, i) => {
    const t = opponents.length === 1 ? 0.5 : i / (opponents.length - 1);
    // arco de 160° a 20° pelo alto: deixa os cantos livres (medalhão à esquerda)
    const angle = ((160 - t * 140) * Math.PI) / 180;
    const x = 50 + 46 * Math.cos(angle);
    const y = 50 - 36 * Math.sin(angle);
    const badge = playerBadge(v, seat, { mao, pe, active: v.toAct === seat });
    badge.style.left = `${x}%`;
    badge.style.top = `${y}%`;
    felt.append(badge);
  });

  // pilha da vaza no centro
  felt.append(pile(p, v, trump));

  box.append(felt);

  // --- sua zona: seu status + ação + mão grande
  const you = h("div", "you-zone");
  you.append(playerBadge(v, v.yourSeat, { mao, pe, active: v.toAct === v.yourSeat, self: true }));
  you.append(actions(p, v));

  const hand = h("div", "hand");
  if (v.yourHand.length === 0) hand.append(h("span", "muted", "mão vazia"));
  const choosing = v.phase === "playing" && v.toAct === v.yourSeat;
  for (const card of v.yourHand) {
    const playable = p.legalPlays.some((c) => c.rank === card.rank && c.suit === card.suit);
    const el = cardEl(card, { playable, dimmed: choosing && !playable });
    if (playable) el.addEventListener("click", () => p.onPlay(card));
    hand.append(el);
  }
  you.append(hand);
  box.append(you);

  return box;
}

// Cartão de um jogador: nome, marca de MÃO/PÉ, previsão/vazas, nº de cartas.
function playerBadge(
  v: PlayerView,
  seat: number,
  o: { mao: number; pe: number; active: boolean; self?: boolean },
): HTMLElement {
  const badge = h(
    "div",
    `badge${o.self ? " self" : ""}${o.active ? " active" : ""}`,
  );

  const top = h("div", "badge-name");
  top.append(h("span", "", v.seats[seat] ?? ""));
  // "ficha vermelha" = MÃO (termo do regulamento); PÉ fecha a ordem de previsão
  if (seat === o.mao) top.append(h("span", "ficha mao", "MÃO"));
  else if (seat === o.pe) top.append(h("span", "ficha pe", "PÉ"));
  badge.append(top);

  const pred = v.predictions[seat];
  const stat =
    v.phase === "awaitingDeal"
      ? "aguardando"
      : pred === null || pred === undefined
        ? v.toAct === seat
          ? "prevendo…"
          : "—"
        : `${v.tricksWon[seat] ?? 0} de ${pred}`;
  const hit =
    pred !== null && pred !== undefined && (v.tricksWon[seat] ?? 0) === pred && pred > 0;
  badge.append(h("div", `badge-stat${hit ? " on-track" : ""}`, stat));
  badge.append(h("div", "badge-cards", plural(v.handCounts[seat] ?? 0, "carta", "cartas")));
  return badge;
}

// A pilha da vaza no centro do feltro (o elemento-assinatura).
function pile(p: RenderProps, v: PlayerView, trump: Suit | null): HTMLElement {
  const closed = v.currentTrick.length === 0 && p.lastTrick !== null;
  const plays: readonly Play[] = closed ? p.lastTrick!.plays : v.currentTrick;
  const wrap = h("div", `pile${closed ? " closed" : ""}`);

  if (plays.length === 0) {
    wrap.append(
      h("span", "pile-empty", v.phase === "awaitingDeal" ? "repartindo…" : "aguardando a vaza"),
    );
    return wrap;
  }

  const cards = h("div", "pile-cards");
  for (const play of plays) {
    const won = closed && play.seat === p.lastTrick!.winner;
    const slot = h("div", `slot${won ? " won" : ""}`);
    const el = cardEl(play.card);
    if (trump && play.card.suit === trump) el.classList.add("is-trump");
    slot.append(el);
    slot.append(h("span", won ? "winner" : "muted", v.seats[play.seat] ?? ""));
    cards.append(slot);
  }
  wrap.append(cards);

  if (closed) {
    const venceu = p.lastTrick!.plays.find((x) => x.seat === p.lastTrick!.winner)!;
    const porTrunfo = trump !== null && venceu.card.suit === trump;
    wrap.append(
      h(
        "div",
        "trick-result",
        `${v.seats[p.lastTrick!.winner] ?? ""} levou a vaza${porTrunfo ? " (trunfo)" : ""}`,
      ),
    );
  }
  return wrap;
}

function actions(p: RenderProps, v: PlayerView): HTMLElement {
  const box = h("div", "actions");

  if (v.phase === "awaitingDeal") {
    box.append(h("span", "muted", `Repartindo a rodada ${v.round}…`));
    return box;
  }

  if (v.toAct !== v.yourSeat) {
    box.append(h("span", "muted", v.toAct === null ? "…" : `Vez de ${v.seats[v.toAct]}`));
    return box;
  }

  if (v.phase === "predicting") {
    box.append(h("span", "prompt", "Quantas vazas você faz?"));
    const all = Array.from({ length: v.tricks + 1 }, (_, i) => i);
    for (const value of all) {
      const legal = p.legalPredictions.includes(value);
      const b = h("button", `bid${legal ? "" : " off"}`, String(value));
      if (legal) b.addEventListener("click", () => p.onPredict(value));
      else b.title = "Trava do PÉ: a soma das previsões não pode dar o nº de vazas";
      box.append(b as HTMLButtonElement);
    }
    return box;
  }

  box.append(h("span", "prompt", "Sua vez — escolha uma carta"));
  if (p.canDeclare) {
    const b = h(
      "button",
      `toggle${p.declareQuemTemPoe ? " on" : ""}`,
      p.declareQuemTemPoe ? '✓ "Quem tem Põe"' : 'Declarar "Quem tem Põe"',
    );
    b.addEventListener("click", p.onToggleQuemTemPoe);
    b.title = "Só puxando trunfo: obriga quem tem trunfo a jogar trunfo";
    box.append(b);
  }
  return box;
}

function scoreboard(p: RenderProps): HTMLElement {
  const box = h("aside", "panel score");
  box.append(h("h2", "", "Placar da noite"));
  box.append(h("p", "muted", "Só sobem pontos de lugar + bônus. A bruta fica na partida."));

  const list = h("ol", "standings");
  for (const s of p.standings) {
    const li = h("li", s.id === p.humanId ? "you" : "");
    li.append(h("span", "", s.id));
    li.append(h("span", "pts", String(s.total)));
    list.append(li);
  }
  box.append(list);

  // resultado da partida anterior, se houver
  const last = p.night.results[p.night.results.length - 1];
  if (last) {
    box.append(h("h2", "", `Partida ${p.night.results.length}`));
    const t = h("table", "result");
    t.innerHTML =
      "<thead><tr><th>Jogador</th><th>Bruta</th><th>Lugar</th><th>Noite</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const r of [...last].sort((a, b) => b.bruta - a.bruta)) {
      const tr = document.createElement("tr");
      if (r.id === p.humanId) tr.className = "you";
      tr.innerHTML = `<td>${r.id}</td><td>${r.bruta}</td><td>${r.rank}º</td><td>${r.nightContribution}</td>`;
      body.append(tr);
    }
    t.append(body);
    box.append(t);
  }
  return box;
}
