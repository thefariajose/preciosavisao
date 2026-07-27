// Desenho puro: recebe o que mostrar e devolve DOM. Nenhuma regra do jogo mora
// aqui — o que é legal chega pronto, vindo do motor.

import { isHit, maoSeatForRound, peSeatForRound, roundScore, type Card, type NightStanding, type NightState, type PartidaPlayerResult, type Play, type PlayerView, type RoundOutcome, type Suit } from "@previsao/engine";

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

// Momentos de pausa entre a ação contínua: fecham uma rodada ou uma partida e
// dão ao jogador tempo de ler o que aconteceu. O controlador os monta e segura.
export interface RoundLine {
  readonly id: string;
  readonly prediction: number;
  readonly tricksWon: number;
  readonly roundValue: number;
}
export type Interlude =
  | { readonly kind: "round"; readonly round: number; readonly lines: readonly RoundLine[]; readonly lastTrick: LastTrick | null }
  | { readonly kind: "partida"; readonly index: number; readonly results: readonly PartidaPlayerResult[]; readonly nextSeating: readonly string[] };

export interface RenderProps {
  readonly view: PlayerView | null;
  readonly night: NightState;
  readonly lastTrick: LastTrick | null;
  readonly interlude: Interlude | null;
  readonly showHelp: boolean;
  readonly humanId: string;
  readonly standings: readonly NightStanding[];
  readonly legalPredictions: readonly number[];
  readonly legalPlays: readonly Card[];
  readonly canDeclare: boolean;
  readonly declareQuemTemPoe: boolean;
  readonly onPredict: (value: number) => void;
  readonly onPlay: (card: Card) => void;
  readonly onToggleQuemTemPoe: () => void;
  readonly onContinue: () => void;
  readonly onToggleHelp: () => void;
  readonly onRestart: () => void;
  readonly onReconfigure: () => void;
}

// Tela de configuração, antes de a noite começar.
export interface SetupProps {
  readonly name: string;
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly roster: readonly string[];
  readonly showHelp: boolean;
  readonly onName: (value: string) => void;
  readonly onCount: (n: number) => void;
  readonly onStart: () => void;
  readonly onToggleHelp: () => void;
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
  const face = card.rank >= 11 ? " face" : "";
  el.className = `card ${isRed(card.suit) ? "red" : "black"}${face}${opts.playable ? " playable" : ""}${
    opts.dimmed ? " dimmed" : ""
  }`;
  const r = rankText(card.rank);
  const s = SUIT_SYMBOL[card.suit];
  const corner = `<span class="cr">${r}</span><span class="cs">${s}</span>`;
  // carta de baralho de verdade: índices espelhados nos cantos + naipe central
  el.innerHTML =
    `<span class="corner tl">${corner}</span>` +
    `<span class="pip">${s}</span>` +
    `<span class="corner br">${corner}</span>`;
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

  const children: HTMLElement[] = [main, scoreboard(p)];
  // overlays por cima de tudo
  if (p.interlude) children.push(interludeOverlay(p));
  if (p.showHelp) children.push(helpOverlay(p.onToggleHelp));
  root.replaceChildren(...children);
}

// ================= tela de configuração =================
export function renderSetup(root: HTMLElement, p: SetupProps): void {
  const box = h("section", "panel modal setup");
  box.append(h("h1", "", "Previsão"));
  box.append(h("p", "muted", "Um humano contra bots, com informação oculta. Configure a mesa."));

  // nome do jogador
  const nameField = h("label", "field");
  nameField.append(h("span", "field-label", "Seu nome"));
  const input = document.createElement("input");
  input.id = "setup-name";
  input.className = "text-input";
  input.type = "text";
  input.maxLength = 14;
  input.value = p.name;
  input.placeholder = "Você";
  input.addEventListener("input", () => p.onName(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") p.onStart();
  });
  nameField.append(input);
  box.append(nameField);

  // número de jogadores
  const countField = h("div", "field");
  countField.append(h("span", "field-label", "Jogadores na mesa"));
  const opts = h("div", "count-opts");
  for (let n = p.min; n <= p.max; n++) {
    const b = h("button", `count-opt${n === p.count ? " on" : ""}`, String(n));
    b.addEventListener("click", () => p.onCount(n));
    opts.append(b);
  }
  countField.append(opts);
  box.append(countField);

  // prévia do elenco
  const preview = h("div", "roster-preview");
  preview.append(h("span", "field-label", `Você + ${p.count - 1} bots`));
  const chips = h("div", "roster-chips");
  p.roster.forEach((id, i) => {
    chips.append(h("span", `roster-chip${i === 0 ? " you" : ""}`, id));
  });
  preview.append(chips);
  box.append(preview);

  const actions = h("div", "modal-actions setup-actions");
  const start = h("button", "primary", "Começar");
  start.addEventListener("click", p.onStart);
  const rules = h("button", "secondary", "Regras");
  rules.addEventListener("click", p.onToggleHelp);
  actions.append(start);
  actions.append(rules);
  box.append(actions);

  const wrap = h("div", "setup-wrap");
  wrap.append(box);

  const children: HTMLElement[] = [wrap];
  if (p.showHelp) children.push(helpOverlay(p.onToggleHelp));
  root.replaceChildren(...children);

  // foco no nome ao abrir (sem roubar o foco se o usuário já está digitando)
  if (document.activeElement !== input) input.focus();
}

// Botão de regras, sempre acessível na barra de contexto.
function rulesButton(p: RenderProps): HTMLElement {
  const b = h("button", "chip rules-btn", "Regras");
  b.addEventListener("click", p.onToggleHelp);
  return b;
}

// ================= interlúdios (fim de rodada / fim de partida) =================
function interludeOverlay(p: RenderProps): HTMLElement {
  const back = h("div", "overlay");
  back.append(p.interlude!.kind === "round" ? roundPanel(p) : partidaPanel(p));
  return back;
}

function roundPanel(p: RenderProps): HTMLElement {
  const it = p.interlude as Extract<Interlude, { kind: "round" }>;
  const box = h("section", "panel modal round-end");
  box.append(h("h2", "", `Rodada ${it.round} encerrada`));

  // a última vaza da rodada, coerente (o overlay não depende do estado avançado)
  if (it.lastTrick) {
    const lt = it.lastTrick;
    const venceu = lt.plays.find((x) => x.seat === lt.winner)!;
    const nome = nameFor(p, lt.winner);
    const porTrunfo = venceu.card.suit === lt.trump;
    const row = h("div", "last-trick");
    const c = cardEl(venceu.card);
    if (porTrunfo) c.classList.add("is-trump");
    row.append(c);
    row.append(h("span", "", `${nome} levou a última vaza${porTrunfo ? " (trunfo)" : ""}`));
    box.append(row);
  }

  const lines = [...it.lines].sort((a, b) => roundScore(b) - roundScore(a));
  const t = document.createElement("table");
  t.className = "tally";
  t.innerHTML = "<thead><tr><th>Jogador</th><th>Previu</th><th>Fez</th><th>Pontos</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const l of lines) {
    const hit = isHit(l);
    const tr = document.createElement("tr");
    tr.className = `${l.id === p.humanId ? "you " : ""}${hit ? "hit" : "miss"}`;
    tr.innerHTML =
      `<td>${l.id}</td><td>${l.prediction}</td><td>${l.tricksWon}</td>` +
      `<td>${hit ? `+${roundScore(l)}` : "0"}</td>`;
    body.append(tr);
  }
  t.append(body);
  box.append(t);

  box.append(actionRow("Continuar", p.onContinue));
  return box;
}

function partidaPanel(p: RenderProps): HTMLElement {
  const it = p.interlude as Extract<Interlude, { kind: "partida" }>;
  const box = h("section", "panel modal partida-end");
  box.append(h("h1", "", `Partida ${it.index + 1} de 3 encerrada`));
  box.append(h("p", "muted", "A bruta decide a colocação; sobem pontos de lugar + bônus."));

  const rows = [...it.results].sort((a, b) => a.rank - b.rank);
  const t = document.createElement("table");
  t.className = "tally wide";
  t.innerHTML =
    "<thead><tr><th>#</th><th>Jogador</th><th>Bruta</th><th>Lugar</th><th>Alta</th><th>≥60</th><th>Noite</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.id === p.humanId) tr.className = "you";
    tr.innerHTML =
      `<td>${r.rank}º</td><td>${r.id}</td><td>${r.bruta}</td><td>${r.placePoints}</td>` +
      `<td>${r.highHitBonus || "—"}</td><td>${r.bandBonus || "—"}</td><td class="tot">${r.nightContribution}</td>`;
    body.append(tr);
  }
  t.append(body);
  box.append(t);

  // o re-assento visível: melhor bruta senta na cabeça (é MÃO da rodada 1)
  const reseat = h("div", "reseat");
  reseat.append(h("h2", "", "Próxima partida — ordem pela bruta"));
  const order = h("div", "seat-order");
  it.nextSeating.forEach((id, i) => {
    const chip = h("span", `seat-chip${id === p.humanId ? " you" : ""}${i === 0 ? " head" : ""}`);
    chip.textContent = i === 0 ? `${id} · cabeça` : id;
    order.append(chip);
  });
  reseat.append(order);
  box.append(reseat);

  box.append(actionRow("Próxima partida", p.onContinue));
  return box;
}

// ================= regras / ajuda =================
function helpOverlay(onClose: () => void): HTMLElement {
  const back = h("div", "overlay");
  back.addEventListener("click", (e) => {
    if (e.target === back) onClose(); // clicar fora fecha
  });
  const box = h("section", "panel modal help");
  box.append(h("h1", "", "Como se joga o Previsão"));

  const secs: [string, string][] = [
    [
      "Objetivo",
      "Em cada rodada você prevê quantas vazas vai fazer e tenta acertar EXATO. A rodada N reparte N cartas (rodada 1 = 1 carta … rodada 10 = 10).",
    ],
    [
      "Trunfo",
      "Antes das previsões, vira-se uma carta: o naipe dela é o trunfo da rodada. Trunfo vence qualquer naipe comum; entre trunfos, vence o maior.",
    ],
    [
      "Previsão e a trava do PÉ",
      "Prevê-se do MÃO (ficha vermelha) até o PÉ, no horário. A soma de todas as previsões NÃO pode dar o nº de vazas — o PÉ é obrigado a ajustar. Sempre há ao menos um erro na mesa.",
    ],
    [
      "Vazas",
      "Não há obrigação de seguir naipe: jogue qualquer carta. Sem trunfo na mesa, vence a maior carta (o naipe não importa entre não-trunfos). Empate de valor idêntico → vence quem jogou primeiro.",
    ],
    [
      "Quem tem Põe",
      "Só quem puxa a vaza pode declarar, e só puxando um trunfo. Obriga todos que tenham trunfo a jogar trunfo. (Os bots não declaram, mas respeitam.)",
    ],
    [
      "Pontos por rodada",
      "Acertou a previsão exata: valor da rodada + previsão. Errou (pra mais ou pra menos): zero. Acertar previsão ≥ 4 dá bônus extra (4→+4, 5→+5, 6→+7, 7+→+10).",
    ],
    [
      "A noite (3 partidas)",
      "A bruta (soma das 10 rodadas) decide a colocação na partida e libera o bônus de ≥60. Para a noite sobem só os pontos de lugar + bônus. Entre partidas, re-assenta-se pela bruta. Maior total nas 3 partidas é o campeão.",
    ],
  ];
  for (const [title, txt] of secs) {
    const sec = h("div", "help-sec");
    sec.append(h("h3", "", title));
    sec.append(h("p", "", txt));
    box.append(sec);
  }

  box.append(actionRow("Fechar", onClose));
  back.append(box);
  return back;
}

function actionRow(label: string, onClick: () => void): HTMLElement {
  const row = h("div", "modal-actions");
  const b = h("button", "primary", label);
  b.addEventListener("click", onClick);
  row.append(b);
  return row;
}

function nameFor(p: RenderProps, seat: number): string {
  return p.view?.seats[seat] ?? p.night.seating[seat] ?? "";
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
  const champs = p.night.champions ?? [];
  const venceu = champs.includes(p.humanId);

  box.append(h("div", "trophy", venceu ? "🏆" : "🃏"));
  box.append(h("h1", "", "Fim da noite"));
  box.append(
    h("p", "champ-label", champs.length > 1 ? "Co-campeões" : "Campeão"),
  );
  box.append(h("p", "champion", champs.join(" · ") || "—"));
  box.append(
    h(
      "p",
      "muted",
      venceu ? "Você levou a noite. Mãos de mestre." : "A próxima é sua.",
    ),
  );
  const actions = h("div", "modal-actions");
  const again = h("button", "primary", "Jogar de novo");
  again.addEventListener("click", p.onRestart);
  const reconf = h("button", "secondary", "Trocar jogadores");
  reconf.addEventListener("click", p.onReconfigure);
  actions.append(again);
  actions.append(reconf);
  box.append(actions);
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
  bar.append(rulesButton(p));
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

  // O arco e o tamanho dos cartões se adaptam ao nº de jogadores: com 6, uma
  // ferradura enxuta pelo alto; com 11, um arco largo descendo pelas laterais,
  // cartões menores e um leve escalonamento radial para não se sobreporem.
  const opp = opponents.length;
  const spanDeg = Math.min(270, 130 + Math.max(0, opp - 5) * 28);
  const compact = opp >= 8;
  opponents.forEach((seat, i) => {
    const t = opp === 1 ? 0.5 : i / (opp - 1);
    const angle = ((90 + spanDeg / 2 - t * spanDeg) * Math.PI) / 180;
    const inset = opp >= 7 && i % 2 === 1 ? 9 : 0; // alterna cartões para dentro
    const x = 50 + (47 - inset) * Math.cos(angle);
    const y = 48 - (43 - inset) * Math.sin(angle);
    const badge = playerBadge(v, seat, { mao, pe, active: v.toAct === seat });
    if (compact) badge.classList.add("compact");
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
  v.yourHand.forEach((card, i) => {
    const playable = p.legalPlays.some((c) => c.rank === card.rank && c.suit === card.suit);
    const el = cardEl(card, { playable, dimmed: choosing && !playable });
    // arco suave na mão, como um leque segurado
    const rot = (i - (v.yourHand.length - 1) / 2) * 2.2;
    el.style.setProperty("--rot", `${rot.toFixed(1)}deg`);
    if (playable) el.addEventListener("click", () => p.onPlay(card));
    hand.append(el);
  });
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

  const name = v.seats[seat] ?? "?";
  const top = h("div", "badge-name");
  const avatar = h("div", "avatar", name.charAt(0).toUpperCase());
  avatar.style.setProperty("--hue", String((seat * 53) % 360)); // cor estável por assento
  top.append(avatar);
  top.append(h("span", "badge-nick", name));
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
  plays.forEach((play, i) => {
    const won = closed && play.seat === p.lastTrick!.winner;
    const slot = h("div", `slot${won ? " won" : ""}`);
    const el = cardEl(play.card);
    // leque: cada carta cai com uma leve inclinação, como jogada na mesa
    const rot = (i - (plays.length - 1) / 2) * 5;
    el.style.setProperty("--rot", `${rot.toFixed(1)}deg`);
    if (trump && play.card.suit === trump) el.classList.add("is-trump");
    slot.append(el);
    slot.append(h("span", won ? "winner" : "muted", v.seats[play.seat] ?? ""));
    cards.append(slot);
  });
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
