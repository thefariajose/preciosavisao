import { describe, expect, it } from "vitest";
import {
  cardStrength,
  chooseBotAction,
  chooseBotPlay,
  chooseBotPrediction,
  expectedTricks,
  roundPayoff,
  trickDistribution,
  unseenPool,
  TRUMP_BOOST,
} from "../src/bot.js";
import { roundConfig } from "../src/dealing.js";
import {
  beginNextPartida,
  createNight,
  nightAction,
  type NightState,
} from "../src/night.js";
import {
  applyAction,
  canDeclareQuemTemPoeNow,
  createPartida,
  currentPlayerSeat,
  currentPredictorSeat,
  legalPlays,
  legalPredictions,
  makeDeal,
  playerView,
  type PartidaState,
} from "../src/partida.js";
import { roundScore } from "../src/scoring.js";
import { maoSeatForRound, predictionOrder } from "../src/seating.js";
import type { Card, Suit } from "../src/types.js";

const c = (rank: number, suit: Card["suit"]): Card => ({ rank: rank as Card["rank"], suit });

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const six = ["a", "b", "c", "d", "e", "f"];
const eleven = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"];

// Fixture: leva a partida direto a uma rodada arbitrária e reparte à mão.
// (O redutor só aceita "deal" em awaitingDeal, que é onde createPartida começa.)
function dealtAtRound(
  seats: readonly string[],
  round: number,
  hands: Card[][],
  trump: Suit,
): PartidaState {
  const base = createPartida(seats);
  const s: PartidaState = { ...base, round, config: roundConfig(round, seats.length) };
  return applyAction(s, { type: "deal", hands, trump });
}

// Prevê por toda a mesa, na ordem MÃO→PÉ. Cai para a primeira previsão legal
// quando a trava do PÉ proíbe o valor pedido.
function predictAll(state: PartidaState, valueFor: (seat: number) => number): PartidaState {
  let s = state;
  for (const seat of predictionOrder(s.round, s.numPlayers)) {
    const legal = legalPredictions(s, seat);
    const want = valueFor(seat);
    s = applyAction(s, { type: "predict", seat, value: legal.includes(want) ? want : legal[0]! });
  }
  return s;
}

// Preenche a mesa com mãos irrelevantes para o assento sob teste.
function fillTable(numPlayers: number, seat: number, hand: Card[], cards: number): Card[][] {
  const hands: Card[][] = [];
  for (let s = 0; s < numPlayers; s++) {
    if (s === seat) {
      hands.push(hand);
      continue;
    }
    const filler: Card[] = [];
    for (let i = 0; i < cards; i++) filler.push(c(((i + s * 3) % 11) + 2, "paus"));
    hands.push(filler);
  }
  return hands;
}

// Dirige uma partida inteira só com bots, asserindo os invariantes a cada passo.
function autoPlayPartida(seats: readonly string[], rng: () => number): PartidaState {
  let s = createPartida(seats);
  let guard = 0;
  while (s.phase !== "partidaComplete") {
    if (++guard > 20000) throw new Error("loop travou");
    if (s.phase === "awaitingDeal") {
      s = applyAction(s, { type: "deal", ...makeDeal(seats.length, s.config, rng) });
      continue;
    }
    const seat = s.phase === "predicting" ? currentPredictorSeat(s)! : currentPlayerSeat(s)!;
    const action = chooseBotAction(s, seat);
    if (action.type === "predict") {
      expect(legalPredictions(s, seat)).toContain(action.value);
    } else if (action.type === "play") {
      expect(legalPlays(s, seat)).toContainEqual(action.card);
      expect(action.declareQuemTemPoe).toBeUndefined();
    }
    s = applyAction(s, action);
    expect(s.quemTemPoe).toBe(false); // bots nunca declaram "Quem tem Põe"
  }
  return s;
}

describe("força da carta", () => {
  it("qualquer trunfo bate qualquer carta comum", () => {
    expect(cardStrength(c(2, "espadas"), "espadas")).toBeGreaterThan(
      cardStrength(c(14, "ouros"), "espadas"),
    );
    expect(cardStrength(c(2, "espadas"), "espadas")).toBe(2 + TRUMP_BOOST);
  });

  it("entre trunfos decide o valor; entre comuns o naipe é irrelevante", () => {
    expect(cardStrength(c(14, "espadas"), "espadas")).toBeGreaterThan(
      cardStrength(c(13, "espadas"), "espadas"),
    );
    // regra §3: sem trunfo na mesa, vence a maior carta seja qual for o naipe
    expect(cardStrength(c(14, "ouros"), "espadas")).toBe(cardStrength(c(14, "copas"), "espadas"));
  });

  it("sem trunfo definido, nada recebe o bônus", () => {
    expect(cardStrength(c(14, "espadas"), null)).toBe(14);
  });
});

describe("pool de cartas não vistas", () => {
  it("o baralho é duplo: tirar uma carta da mão deixa a outra cópia no pool", () => {
    const hands = fillTable(6, 0, [c(5, "copas")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    const pool = unseenPool(playerView(s, 0));
    // a segunda cópia do 5 de copas continua viva — um filter(!sameCard) teria
    // removido as duas, e o bug só apareceria como previsão levemente errada
    expect(pool.filter((x) => x.rank === 5 && x.suit === "copas")).toHaveLength(1);
  });

  it("remove a própria mão e tudo que já caiu na rodada", () => {
    const hands = fillTable(6, 0, [c(5, "copas")], 1);
    let s = dealtAtRound(six, 1, hands, "espadas");
    expect(unseenPool(playerView(s, 0))).toHaveLength(104 - 1);

    for (let seat = 0; seat < 6; seat++) s = applyAction(s, { type: "predict", seat, value: 0 });
    s = applyAction(s, { type: "play", seat: 0, card: c(5, "copas") });
    // o assento 1 tem 1 carta na mão e vê 1 carta já jogada
    expect(unseenPool(playerView(s, 1))).toHaveLength(104 - 1 - 1);
  });

  it("não desconta duas vezes: playedThisRound já contém a vaza atual", () => {
    // rodada 2 → o MÃO é o assento 1. Depois de 2 jogadas, o log tem 2 cartas e
    // currentTrick tem as MESMAS 2. Somar as duas listas tiraria 4 do pool.
    const mao = maoSeatForRound(2, 6);
    const hands = fillTable(6, mao, [c(14, "espadas"), c(3, "ouros")], 2);
    let s = dealtAtRound(six, 2, hands, "espadas");
    s = predictAll(s, () => 0);
    s = applyAction(s, { type: "play", seat: mao, card: c(14, "espadas") });
    s = applyAction(s, { type: "play", seat: (mao + 1) % 6, card: playerView(s, (mao + 1) % 6).yourHand[0]! });

    const view = playerView(s, mao);
    expect(view.currentTrick).toHaveLength(2);
    expect(view.playedThisRound).toHaveLength(2);
    // 104 − 1 carta ainda na mão − 2 já jogadas
    expect(unseenPool(view)).toHaveLength(104 - 1 - 2);
  });
});

describe("distribuição de vazas e payoff", () => {
  it("a Poisson-binomial soma 1 e tem média igual à soma dos pWin", () => {
    const dist = trickDistribution([0.5, 0.25, 0.1]);
    expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const mean = dist.reduce((acc, d, k) => acc + d * k, 0);
    expect(mean).toBeCloseTo(0.85, 10);
  });

  it("certeza e impossibilidade viram distribuições degeneradas", () => {
    expect(trickDistribution([1, 1])).toEqual([0, 0, 1]);
    expect(trickDistribution([0, 0])).toEqual([1, 0, 0]);
  });

  it("o payoff sai da cascata de pontuação, com o degrau do bônus em 4", () => {
    // acerto paga valor da rodada + previsão...
    expect(roundPayoff(3, 10)).toBe(13);
    // ...e a partir de 4 entra o bônus de alta (4/5/7/10)
    expect(roundPayoff(4, 10)).toBe(10 + 4 + 4);
    expect(roundPayoff(5, 10)).toBe(10 + 5 + 5);
    expect(roundPayoff(6, 10)).toBe(10 + 6 + 7);
    expect(roundPayoff(7, 10)).toBe(10 + 7 + 10);
    // rodada curta: não existe previsão >= 4, então não existe bônus
    expect(roundPayoff(1, 1)).toBe(2);
  });
});

describe("empate do baralho duplo (vence quem jogou primeiro)", () => {
  it("o A de trunfo na mão vale uma vaza certa: a cópia idêntica empata e perde", () => {
    const hands = fillTable(6, 0, [c(14, "espadas")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    // nada bate ESTRITAMENTE o A de trunfo; a outra cópia empata e, por ser
    // jogada depois, perde. Logo pWin = 1.
    expect(expectedTricks(playerView(s, 0))).toBeCloseTo(1, 10);
  });

  it("com o A de trunfo já na mesa, o bot não queima a segunda cópia", () => {
    // rodada 2 → o MÃO é o assento 1, e o assento 2 joga logo depois dele
    const mao = maoSeatForRound(2, 6);
    const next = (mao + 1) % 6;
    const hands: Card[][] = fillTable(6, mao, [c(14, "espadas"), c(3, "ouros")], 2);
    hands[next] = [c(14, "espadas"), c(2, "ouros")]; // a cópia idêntica do A
    let s = dealtAtRound(six, 2, hands, "espadas");
    s = predictAll(s, (seat) => (seat === next ? 1 : 0));

    s = applyAction(s, { type: "play", seat: mao, card: c(14, "espadas") });

    // o A do assento `next` só EMPATARIA, e empate perde para quem jogou antes:
    // a vaza está perdida, então o bot descarta a fraca em vez de queimar o A
    expect(currentPlayerSeat(s)).toBe(next);
    expect(chooseBotPlay(s, next)).toEqual(c(2, "ouros"));
  });
});

describe("previsão", () => {
  it("rodada 1: um A comum não vale uma vaza contra 5 oponentes → prevê 0", () => {
    const hands = fillTable(6, 0, [c(14, "ouros")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    expect(chooseBotPrediction(s, 0)).toBe(0);
  });

  it("rodada 1: o A de trunfo é vaza certa → prevê 1", () => {
    const hands = fillTable(6, 0, [c(14, "espadas")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    expect(chooseBotPrediction(s, 0)).toBe(1);
  });

  it("maximiza PONTOS, não taxa de acerto", () => {
    // 8 de trunfo na rodada 1: pWin ~0.45. A moda da distribuição é 0 (é mais
    // provável perder que ganhar), mas prever 0 paga 1 e prever 1 paga 2 — então
    // 0.45 × 2 > 0.55 × 1 e o EV manda prever 1. round(Σ pWin) erraria aqui.
    const hands = fillTable(6, 0, [c(8, "espadas")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    const pWin = expectedTricks(playerView(s, 0));
    expect(pWin).toBeGreaterThan(1 / 3);
    expect(pWin).toBeLessThan(0.5); // a moda é 0...
    expect(chooseBotPrediction(s, 0)).toBe(1); // ...mas o EV escolhe 1
  });

  it("rodada 10: mão de lixo não vira previsão alta", () => {
    const mao = maoSeatForRound(10, 6);
    const junk = [2, 3, 4, 5, 6, 7, 8, 2, 3, 4].map((r) => c(r, "ouros"));
    const s = dealtAtRound(six, 10, fillTable(6, mao, junk, 10), "espadas");
    expect(chooseBotPrediction(s, mao)).toBeLessThan(3);
  });

  it("rodada 10: mão forte de trunfos vira previsão alta", () => {
    const mao = maoSeatForRound(10, 6);
    const hand = [14, 13, 12, 11].map((r) => c(r, "espadas"));
    for (const r of [2, 3, 4, 5, 6, 7]) hand.push(c(r, "ouros"));
    const s = dealtAtRound(six, 10, fillTable(6, mao, hand, 10), "espadas");
    expect(chooseBotPrediction(s, mao)).toBe(4);
  });

  it("a trava do PÉ obriga o erro: o PÉ com vaza certa é forçado a prever 0", () => {
    // Regulamento §3: a soma das previsões não pode dar o nº de vazas, e é o PÉ
    // quem ajusta. Com todos prevendo 0 numa rodada de 1 vaza, o PÉ fica proibido
    // de prever 1 — mesmo tendo o A de trunfo na mão e sabendo que vai furar.
    const hands = fillTable(6, 5, [c(14, "espadas")], 1);
    let s = dealtAtRound(six, 1, hands, "espadas");
    for (let seat = 0; seat < 5; seat++) {
      s = applyAction(s, { type: "predict", seat, value: 0 });
    }
    expect(legalPredictions(s, 5)).toEqual([0]);
    expect(expectedTricks(playerView(s, 5))).toBeCloseTo(1, 10); // vaza garantida
    expect(chooseBotPrediction(s, 5)).toBe(0); // e ainda assim prevê 0
  });

  it("11 jogadores na rodada 10: prevê no máximo 9 (vazas), mas o payoff usa 10", () => {
    const mao = maoSeatForRound(10, 11);
    const hand = [14, 13, 12, 11, 10, 9, 8, 7, 6].map((r) => c(r, "espadas"));
    const s = dealtAtRound(eleven, 10, fillTable(11, mao, hand, 9), "espadas");
    expect(s.config.cardsDealt).toBe(9);
    expect(s.config.roundValue).toBe(10);
    const pred = chooseBotPrediction(s, mao);
    expect(pred).toBeLessThanOrEqual(9);
    expect(legalPredictions(s, mao)).toContain(pred);
  });

  it("lança fora da vez", () => {
    const hands = fillTable(6, 0, [c(14, "ouros")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    expect(() => chooseBotPrediction(s, 3)).toThrow(/previsão/i);
  });
});

describe("jogada", () => {
  // Rodada 3, o MÃO tem A de trunfo (vaza certa) + duas cartas fracas.
  function scenario(prediction: number): PartidaState {
    const mao = maoSeatForRound(3, 6);
    const hand = [c(14, "espadas"), c(3, "ouros"), c(2, "copas")];
    const s = dealtAtRound(six, 3, fillTable(6, mao, hand, 3), "espadas");
    return predictAll(s, (seat) => (seat === mao ? prediction : 0));
  }

  it("quem previu 0 não gasta a carta forte", () => {
    const s = scenario(0);
    const mao = maoSeatForRound(3, 6);
    expect(currentPlayerSeat(s)).toBe(mao);
    expect(chooseBotPlay(s, mao)).not.toEqual(c(14, "espadas"));
  });

  it("quem precisa da vaza puxa a carta forte", () => {
    const s = scenario(1);
    const mao = maoSeatForRound(3, 6);
    expect(chooseBotPlay(s, mao)).toEqual(c(14, "espadas"));
  });

  it("quem já furou descarta, sem queimar a carta forte", () => {
    // previu 0 e já venceu uma vaza → rodada perdida, nada a preservar…
    // …mas também nada a ganhar: descarta a mais fraca em vez de gastar o trunfo
    const s = scenario(0);
    const mao = maoSeatForRound(3, 6);
    const busted: PartidaState = { ...s, tricksWon: s.tricksWon.map((_, i) => (i === mao ? 1 : 0)) };
    expect(chooseBotPlay(busted, mao)).not.toEqual(c(14, "espadas"));
  });

  it("a carta escolhida está sempre entre as legais", () => {
    const s = scenario(1);
    const mao = maoSeatForRound(3, 6);
    expect(legalPlays(s, mao)).toContainEqual(chooseBotPlay(s, mao));
  });

  it("lança fora da vez", () => {
    const s = scenario(1);
    const mao = maoSeatForRound(3, 6);
    expect(() => chooseBotPlay(s, (mao + 1) % 6)).toThrow(/jogar/i);
  });
});

describe('"Quem tem Põe"', () => {
  it("o bot nunca declara, mesmo podendo", () => {
    const mao = maoSeatForRound(2, 6);
    const hand = [c(14, "espadas"), c(13, "espadas")]; // só trunfos → pode declarar
    let s = dealtAtRound(six, 2, fillTable(6, mao, hand, 2), "espadas");
    s = predictAll(s, (seat) => (seat === mao ? 2 : 0));
    const action = chooseBotAction(s, mao);
    expect(action.type).toBe("play");
    expect(canDeclareQuemTemPoeNow(s, mao, (action as { card: Card }).card)).toBe(true);
    // ...e ainda assim o campo é OMITIDO (simplificação de base, CLAUDE.md §6)
    expect((action as { declareQuemTemPoe?: boolean }).declareQuemTemPoe).toBeUndefined();
  });

  it("o bot respeita a declaração de outro jogador", () => {
    const mao = maoSeatForRound(1, 6); // rodada 1 → assento 0
    const hands: Card[][] = [
      [c(5, "espadas")], // puxador humano, declara
      [c(9, "espadas")], // bot COM trunfo → obrigado a jogar trunfo
      [c(4, "ouros")], // bot SEM trunfo → livre
      [c(3, "paus")],
      [c(2, "copas")],
      [c(8, "ouros")],
    ];
    let s = dealtAtRound(six, 1, hands, "espadas");
    for (let seat = 0; seat < 6; seat++) s = applyAction(s, { type: "predict", seat, value: 0 });
    expect(mao).toBe(0);
    s = applyAction(s, { type: "play", seat: 0, card: c(5, "espadas"), declareQuemTemPoe: true });
    expect(s.quemTemPoe).toBe(true);

    // com trunfo: a única jogada legal é o trunfo, e o bot a escolhe sem lançar
    const withTrump = chooseBotAction(s, 1);
    expect((withTrump as { card: Card }).card).toEqual(c(9, "espadas"));
    s = applyAction(s, withTrump);

    // sem trunfo: joga livre
    const withoutTrump = chooseBotAction(s, 2);
    expect((withoutTrump as { card: Card }).card).toEqual(c(4, "ouros"));
    expect(() => applyAction(s, withoutTrump)).not.toThrow();
  });
});

describe("determinismo e informação oculta", () => {
  it("o mesmo estado produz sempre a mesma ação", () => {
    const hands = fillTable(6, 0, [c(9, "copas")], 1);
    const s = dealtAtRound(six, 1, hands, "espadas");
    expect(chooseBotAction(s, 0)).toEqual(chooseBotAction(s, 0));
  });

  it("a partida inteira é reprodutível com a mesma semente", () => {
    const a = autoPlayPartida(six, seededRng(2026));
    const b = autoPlayPartida(six, seededRng(2026));
    expect(a.result).toEqual(b.result);
  });

  it("NÃO TRAPACEIA: trocar as mãos alheias por lixo não muda a decisão", () => {
    // o bot só pode usar o que playerView exporia — e de mão alheia isso é
    // apenas a CONTAGEM de cartas. Se ele lesse as cartas em si, esta asserção
    // quebraria.
    const mao = maoSeatForRound(4, 6);
    const hand = [c(14, "espadas"), c(7, "ouros"), c(3, "copas"), c(2, "paus")];
    let s = dealtAtRound(six, 4, fillTable(6, mao, hand, 4), "espadas");
    s = predictAll(s, (seat) => (seat === mao ? 1 : 0));
    const before = chooseBotAction(s, mao);

    // troca o CONTEÚDO das mãos alheias, preservando os tamanhos (que são públicos)
    const tampered: PartidaState = {
      ...s,
      hands: s.hands.map((h, seat) =>
        seat === mao ? h.slice() : h.map(() => c(14, "espadas")),
      ),
    };
    expect(tampered.hands.map((h) => h.length)).toEqual(s.hands.map((h) => h.length));
    expect(chooseBotAction(tampered, mao)).toEqual(before);
  });

  it("não tem ação fora das fases de previsão e vaza", () => {
    const s = createPartida(six);
    expect(s.phase).toBe("awaitingDeal");
    expect(() => chooseBotAction(s, 0)).toThrow(/fase/i);
  });
});

describe("partida e noite inteiras só com bots", () => {
  it("6 jogadores: joga as 10 rodadas respeitando todas as regras", () => {
    const s = autoPlayPartida(six, seededRng(2026));
    expect(s.phase).toBe("partidaComplete");
    expect(s.result).toHaveLength(6);
    for (let seat = 0; seat < 6; seat++) expect(s.outcomes[seat]).toHaveLength(10);
  });

  it("11 jogadores: a rodada 10 tem 9 vazas valendo 10 e a partida fecha", () => {
    const s = autoPlayPartida(eleven, seededRng(7));
    expect(s.phase).toBe("partidaComplete");
    expect(s.result).toHaveLength(11);
    for (const o of s.outcomes[0]!.slice(9)) {
      expect(o.roundValue).toBe(10);
      expect(o.prediction).toBeLessThanOrEqual(9);
    }
  });

  it("noite inteira (3 partidas) chega ao campeão", () => {
    const rng = seededRng(99);
    let n: NightState = createNight(six);
    let guard = 0;
    while (n.phase !== "nightComplete") {
      if (++guard > 100000) throw new Error("loop travou");
      if (n.phase === "awaitingPartida") {
        n = beginNextPartida(n, rng);
        continue;
      }
      const p = n.partida!;
      if (p.phase === "awaitingDeal") {
        n = nightAction(n, { type: "deal", ...makeDeal(p.numPlayers, p.config, rng) });
      } else {
        const seat = p.phase === "predicting" ? currentPredictorSeat(p)! : currentPlayerSeat(p)!;
        n = nightAction(n, chooseBotAction(p, seat));
      }
    }
    expect(n.results).toHaveLength(3);
    expect(n.champions!.length).toBeGreaterThanOrEqual(1);
  });

  it("calibração: a soma das previsões da mesa fica na ordem do nº de vazas", () => {
    // Só existem `tricks` vazas na rodada, então a soma das previsões tem que
    // orbitar esse valor. É a rede que pega regressão grosseira de heurística:
    // um modelo otimista demais somava ~21 numa rodada de 10 vazas; um
    // pessimista demais somava ~3. A banda é larga de propósito.
    const perRound = new Map<number, number[]>();
    for (let seed = 1; seed <= 6; seed++) {
      let s = createPartida(six);
      const rng = seededRng(seed * 101);
      let guard = 0;
      while (s.phase !== "partidaComplete") {
        if (++guard > 20000) throw new Error("loop travou");
        if (s.phase === "awaitingDeal") {
          s = applyAction(s, { type: "deal", ...makeDeal(6, s.config, rng) });
          continue;
        }
        const round = s.round;
        const seat = s.phase === "predicting" ? currentPredictorSeat(s)! : currentPlayerSeat(s)!;
        const wasPredicting = s.phase === "predicting";
        s = applyAction(s, chooseBotAction(s, seat));
        if (wasPredicting && s.phase === "playing") {
          const sum = s.predictions.reduce<number>((a, p) => a + (p ?? 0), 0);
          perRound.set(round, [...(perRound.get(round) ?? []), sum]);
        }
      }
    }
    for (let round = 1; round <= 10; round++) {
      const sums = perRound.get(round)!;
      const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
      const tricks = roundConfig(round, 6).tricks;
      expect(avg).toBeGreaterThan(tricks * 0.4);
      expect(avg).toBeLessThan(tricks * 1.8 + 1);
      // e a trava do PÉ garante que nenhuma soma bate exatamente o nº de vazas
      for (const sum of sums) expect(sum).not.toBe(tricks);
    }
  });
});

describe("sanidade estatística (teste de fumaça, não de qualidade)", () => {
  it("o bot pontua muito acima de um jogador aleatório legal", () => {
    // O alvo é PONTOS, não taxa de acerto: um bot que sempre prevê 0 acertaria
    // muito e seria péssimo, porque 0 é o payoff mínimo do regulamento.
    //
    // Sementes fixas → determinístico, não flaky. A margem é folgada de
    // propósito (medido: ~4.8x): se uma melhoria deliberada de heurística mexer
    // no número, reajustar o limiar é legítimo — isto aqui é fumaça.
    function averageRoundScore(useBot: boolean): number {
      const scores: number[] = [];
      for (let seed = 1; seed <= 8; seed++) {
        let s = createPartida(six);
        const rng = seededRng(seed * 101);
        const pick = seededRng(seed * 7717);
        let guard = 0;
        while (s.phase !== "partidaComplete") {
          if (++guard > 20000) throw new Error("loop travou");
          if (s.phase === "awaitingDeal") {
            s = applyAction(s, { type: "deal", ...makeDeal(6, s.config, rng) });
          } else if (s.phase === "predicting") {
            const seat = currentPredictorSeat(s)!;
            const legal = legalPredictions(s, seat);
            s = applyAction(
              s,
              useBot
                ? chooseBotAction(s, seat)
                : { type: "predict", seat, value: legal[Math.floor(pick() * legal.length)]! },
            );
          } else {
            const seat = currentPlayerSeat(s)!;
            const legal = legalPlays(s, seat);
            s = applyAction(
              s,
              useBot
                ? chooseBotAction(s, seat)
                : { type: "play", seat, card: legal[Math.floor(pick() * legal.length)]! },
            );
          }
        }
        for (let seat = 0; seat < 6; seat++) {
          for (const o of s.outcomes[seat]!) scores.push(roundScore(o));
        }
      }
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    }
    expect(averageRoundScore(true)).toBeGreaterThan(averageRoundScore(false) * 3);
  });
});
