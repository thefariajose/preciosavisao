import { describe, expect, it } from "vitest";
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
import { roundConfig } from "../src/dealing.js";
import type { Card } from "../src/types.js";

const c = (rank: number, suit: Card["suit"]): Card => ({ rank: rank as Card["rank"], suit });

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const six = ["a", "b", "c", "d", "e", "f"];

describe("criação e deal", () => {
  it("começa na rodada 1 aguardando o deal", () => {
    const s = createPartida(six);
    expect(s.round).toBe(1);
    expect(s.phase).toBe("awaitingDeal");
    expect(s.config.tricks).toBe(1);
  });

  it('"deal" leva para a fase de previsão', () => {
    let s = createPartida(six);
    const deal = makeDeal(6, s.config, seededRng(1));
    s = applyAction(s, { type: "deal", ...deal });
    expect(s.phase).toBe("predicting");
    expect(s.trump).not.toBeNull();
    expect(s.hands.every((h) => h.length === 1)).toBe(true);
  });

  it("rejeita prever antes do deal", () => {
    const s = createPartida(six);
    expect(() => applyAction(s, { type: "predict", seat: 0, value: 0 })).toThrow();
  });
});

describe("fase de previsão", () => {
  function dealt(): PartidaState {
    let s = createPartida(six);
    // deal manual (round 1 = 1 carta), trunfo espadas
    const hands: Card[][] = [
      [c(14, "ouros")],
      [c(2, "espadas")],
      [c(13, "paus")],
      [c(3, "copas")],
      [c(5, "ouros")],
      [c(7, "paus")],
    ];
    s = applyAction(s, { type: "deal", hands, trump: "espadas" });
    return s;
  }

  it("respeita a ordem MÃO → PÉ", () => {
    let s = dealt();
    expect(currentPredictorSeat(s)).toBe(0);
    expect(() => applyAction(s, { type: "predict", seat: 1, value: 0 })).toThrow();
    s = applyAction(s, { type: "predict", seat: 0, value: 0 });
    expect(currentPredictorSeat(s)).toBe(1);
  });

  it("aplica a trava do PÉ", () => {
    let s = dealt();
    for (let seat = 0; seat < 5; seat++) {
      s = applyAction(s, { type: "predict", seat, value: 0 });
    }
    // 1 vaza, outros somam 0 → PÉ não pode prever 1
    expect(legalPredictions(s, 5)).toEqual([0]);
    expect(() => applyAction(s, { type: "predict", seat: 5, value: 1 })).toThrow();
    s = applyAction(s, { type: "predict", seat: 5, value: 0 });
    expect(s.phase).toBe("playing");
  });
});

describe("fase de vaza e avanço de rodada", () => {
  it("resolve a vaza, credita ao vencedor e avança a rodada", () => {
    let s = createPartida(six);
    const hands: Card[][] = [
      [c(14, "ouros")],
      [c(2, "espadas")], // único trunfo → vence
      [c(13, "paus")],
      [c(3, "copas")],
      [c(5, "ouros")],
      [c(7, "paus")],
    ];
    s = applyAction(s, { type: "deal", hands, trump: "espadas" });
    // previsões: seat1 prevê 1 (espera vencer), demais 0; PÉ ajusta
    s = applyAction(s, { type: "predict", seat: 0, value: 0 });
    s = applyAction(s, { type: "predict", seat: 1, value: 1 });
    s = applyAction(s, { type: "predict", seat: 2, value: 0 });
    s = applyAction(s, { type: "predict", seat: 3, value: 0 });
    s = applyAction(s, { type: "predict", seat: 4, value: 0 });
    // outros somam 1 → PÉ não pode prever 0; prevê 1
    s = applyAction(s, { type: "predict", seat: 5, value: 1 });

    // joga a única vaza na ordem 0..5
    for (const seat of [0, 1, 2, 3, 4, 5]) {
      expect(currentPlayerSeat(s)).toBe(seat);
      s = applyAction(s, { type: "play", seat, card: hands[seat]![0]! });
    }

    // rodada encerrou e avançou
    expect(s.round).toBe(2);
    expect(s.phase).toBe("awaitingDeal");
    // o assento 1 (trunfo) venceu e acertou a previsão de 1
    expect(s.outcomes[1]![0]).toEqual({ prediction: 1, tricksWon: 1, roundValue: 1 });
    // o PÉ previu 1 mas fez 0 → erro registrado
    expect(s.outcomes[5]![0]).toEqual({ prediction: 1, tricksWon: 0, roundValue: 1 });
  });

  it("rejeita jogar carta que não está na mão", () => {
    let s = createPartida(six);
    const hands: Card[][] = six.map(() => [c(9, "ouros")]);
    s = applyAction(s, { type: "deal", hands, trump: "espadas" });
    // todos preveem 0 (soma 0 ≠ 1 vaza) → fase de vaza
    for (let seat = 0; seat < 6; seat++) s = applyAction(s, { type: "predict", seat, value: 0 });
    expect(s.phase).toBe("playing");
    // assento 0 tenta jogar uma carta que não tem
    expect(() => applyAction(s, { type: "play", seat: 0, card: c(14, "espadas") })).toThrow();
    // jogando a carta correta funciona
    s = applyAction(s, { type: "play", seat: 0, card: c(9, "ouros") });
    expect(currentPlayerSeat(s)).toBe(1);
  });
});

describe('"Quem tem Põe" na máquina de estados', () => {
  it("o puxador com trunfo pode declarar e obriga os demais", () => {
    let s = createPartida(six);
    // rodada 2 seria 2 cartas; para simplificar forçamos rodada 1 com 1 carta
    const trump = "copas";
    const hands: Card[][] = [
      [c(5, "copas")], // puxador, trunfo
      [c(9, "copas")], // tem trunfo → obrigado
      [c(4, "ouros")], // sem trunfo → livre
      [c(3, "paus")],
      [c(2, "espadas")],
      [c(8, "ouros")],
    ];
    s = applyAction(s, { type: "deal", hands, trump });
    // todos preveem 0 (soma 0 ≠ 1 vaza) → fase de vaza
    for (let seat = 0; seat < 6; seat++) s = applyAction(s, { type: "predict", seat, value: 0 });

    // assento 0 declara Quem tem Põe jogando trunfo
    expect(canDeclareQuemTemPoeNow(s, 0, c(5, "copas"))).toBe(true);
    s = applyAction(s, { type: "play", seat: 0, card: c(5, "copas"), declareQuemTemPoe: true });
    expect(s.quemTemPoe).toBe(true);

    // assento 1 tem trunfo → só pode jogar trunfo
    expect(legalPlays(s, 1)).toEqual([c(9, "copas")]);

    // assento 2 não tem trunfo → livre
    // avança 1 (obrigado)
    s = applyAction(s, { type: "play", seat: 1, card: c(9, "copas") });
    // assento 2 joblivre
    expect(legalPlays(s, 2)).toEqual([c(4, "ouros")]);
  });
});

describe("partida inteira (auto-play determinístico)", () => {
  it("6 jogadores: joga as 10 rodadas e chega em partidaComplete", () => {
    let s = createPartida(six);
    const rng = seededRng(2026);
    let guard = 0;
    while (s.phase !== "partidaComplete") {
      if (++guard > 5000) throw new Error("loop travou");
      if (s.phase === "awaitingDeal") {
        s = applyAction(s, { type: "deal", ...makeDeal(6, s.config, rng) });
      } else if (s.phase === "predicting") {
        const seat = currentPredictorSeat(s)!;
        const value = legalPredictions(s, seat)[0]!;
        s = applyAction(s, { type: "predict", seat, value });
      } else if (s.phase === "playing") {
        const seat = currentPlayerSeat(s)!;
        const card = legalPlays(s, seat)[0]!;
        s = applyAction(s, { type: "play", seat, card });
      }
    }
    expect(s.phase).toBe("partidaComplete");
    expect(s.result).toHaveLength(6);
    // cada jogador jogou exatamente 10 rodadas
    for (let seat = 0; seat < 6; seat++) {
      expect(s.outcomes[seat]).toHaveLength(10);
    }
    // ranks cobrem 1..6 de forma coerente (competição padrão)
    const ranks = s.result!.map((r) => r.rank).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    // contribuição = lugar + alta + faixa
    for (const r of s.result!) {
      expect(r.nightContribution).toBe(r.placePoints + r.highHitBonus + r.bandBonus);
    }
  });

  it("11 jogadores: a 10ª rodada distribui 9 cartas e a partida fecha", () => {
    const eleven = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"];
    let s = createPartida(eleven);
    const rng = seededRng(7);
    let sawRound10 = false;
    let guard = 0;
    while (s.phase !== "partidaComplete") {
      if (++guard > 20000) throw new Error("loop travou");
      if (s.phase === "awaitingDeal") {
        if (s.round === 10) {
          sawRound10 = true;
          expect(s.config.cardsDealt).toBe(9);
          expect(s.config.roundValue).toBe(10);
        }
        s = applyAction(s, { type: "deal", ...makeDeal(11, s.config, rng) });
      } else if (s.phase === "predicting") {
        const seat = currentPredictorSeat(s)!;
        s = applyAction(s, { type: "predict", seat, value: legalPredictions(s, seat)[0]! });
      } else {
        const seat = currentPlayerSeat(s)!;
        s = applyAction(s, { type: "play", seat, card: legalPlays(s, seat)[0]! });
      }
    }
    expect(sawRound10).toBe(true);
    expect(s.result).toHaveLength(11);
  });
});

describe("histórico de cartas jogadas na rodada", () => {
  it("acumula ao longo das vazas e zera só na rodada seguinte", () => {
    let s = createPartida(six);
    // rodada 1: 1 carta por mão, 1 vaza
    const hands: Card[][] = [
      [c(14, "ouros")],
      [c(2, "espadas")],
      [c(13, "paus")],
      [c(3, "copas")],
      [c(5, "ouros")],
      [c(7, "paus")],
    ];
    s = applyAction(s, { type: "deal", hands, trump: "espadas" });
    expect(s.playedThisRound).toEqual([]);
    for (let seat = 0; seat < 6; seat++) s = applyAction(s, { type: "predict", seat, value: 0 });

    for (let seat = 0; seat < 5; seat++) {
      s = applyAction(s, { type: "play", seat, card: hands[seat]![0]! });
      expect(s.playedThisRound).toHaveLength(seat + 1);
    }
    // a última jogada fecha a vaza E a rodada: o log zera junto com a rodada
    s = applyAction(s, { type: "play", seat: 5, card: hands[5]![0]! });
    expect(s.round).toBe(2);
    expect(s.playedThisRound).toEqual([]);
  });

  it("o log sobrevive ao fim da vaza, ao contrário de currentTrick", () => {
    let s = createPartida(six);
    // rodada 2: 2 cartas por mão, 2 vazas
    const hands: Card[][] = [
      [c(14, "ouros"), c(9, "ouros")],
      [c(2, "espadas"), c(3, "espadas")],
      [c(13, "paus"), c(12, "paus")],
      [c(3, "copas"), c(4, "copas")],
      [c(5, "ouros"), c(6, "ouros")],
      [c(7, "paus"), c(8, "paus")],
    ];
    s = { ...s, round: 2, config: roundConfig(2, 6) };
    s = applyAction(s, { type: "deal", hands, trump: "espadas" });
    for (const seat of [1, 2, 3, 4, 5, 0]) s = applyAction(s, { type: "predict", seat, value: 0 });

    // joga a 1ª vaza inteira (rodada 2 → o MÃO é o assento 1)
    for (const seat of [1, 2, 3, 4, 5, 0]) {
      s = applyAction(s, { type: "play", seat, card: hands[seat]![0]! });
    }
    expect(s.trickNumber).toBe(2);
    expect(s.currentTrick).toEqual([]); // a vaza foi limpa...
    expect(s.playedThisRound).toHaveLength(6); // ...mas o log da rodada não
  });

  it("na última rodada o log fica de pé: partidaComplete guarda as cartas da 10ª", () => {
    // não há "rodada seguinte" para zerar, e é assim que predictions/tricksWon
    // também se comportam ao fim da partida
    let s = createPartida(six);
    const rng = seededRng(2026);
    let guard = 0;
    while (s.phase !== "partidaComplete") {
      if (++guard > 5000) throw new Error("loop travou");
      if (s.phase === "awaitingDeal") {
        s = applyAction(s, { type: "deal", ...makeDeal(6, s.config, rng) });
      } else if (s.phase === "predicting") {
        const seat = currentPredictorSeat(s)!;
        s = applyAction(s, { type: "predict", seat, value: legalPredictions(s, seat)[0]! });
      } else {
        const seat = currentPlayerSeat(s)!;
        s = applyAction(s, { type: "play", seat, card: legalPlays(s, seat)[0]! });
      }
    }
    expect(s.playedThisRound).toHaveLength(10 * 6); // as 10 vazas da rodada 10
  });

  it("a view expõe o log (é informação pública: todos veem o que caiu)", () => {
    let s = createPartida(six);
    const hands: Card[][] = six.map(() => [c(9, "ouros")]);
    s = applyAction(s, { type: "deal", hands, trump: "espadas" });
    for (let seat = 0; seat < 6; seat++) s = applyAction(s, { type: "predict", seat, value: 0 });
    s = applyAction(s, { type: "play", seat: 0, card: c(9, "ouros") });
    expect(playerView(s, 3).playedThisRound).toEqual([c(9, "ouros")]);
  });
});

describe("redação para o cliente", () => {
  it("esconde as mãos alheias mas mostra as contagens", () => {
    let s = createPartida(six);
    s = applyAction(s, { type: "deal", ...makeDeal(6, s.config, seededRng(3)) });
    const view = playerView(s, 2);
    expect(view.yourHand.length).toBe(1);
    expect(view.handCounts).toHaveLength(6);
    // a view não expõe o array hands completo
    expect((view as unknown as { hands?: unknown }).hands).toBeUndefined();
  });
});
