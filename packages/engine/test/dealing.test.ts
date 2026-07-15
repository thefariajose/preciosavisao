import { describe, expect, it } from "vitest";
import {
  assertPlayerCount,
  maxCardsPerRound,
  partidaSchedule,
  roundConfig,
} from "../src/dealing.js";

describe("distribuição", () => {
  it("aceita de 6 a 11 jogadores e rejeita fora disso", () => {
    expect(() => assertPlayerCount(6)).not.toThrow();
    expect(() => assertPlayerCount(11)).not.toThrow();
    expect(() => assertPlayerCount(5)).toThrow();
    expect(() => assertPlayerCount(12)).toThrow();
  });

  it("rodada N distribui N cartas para mesas de até 10 jogadores", () => {
    for (let round = 1; round <= 10; round++) {
      expect(roundConfig(round, 10).cardsDealt).toBe(round);
      expect(roundConfig(round, 10).roundValue).toBe(round);
    }
  });

  it("com 11 jogadores, a 10ª rodada distribui 9 cartas mas VALE 10", () => {
    const r10 = roundConfig(10, 11);
    expect(r10.cardsDealt).toBe(9);
    expect(r10.tricks).toBe(9); // só 9 vazas reais
    expect(r10.roundValue).toBe(10); // mas pontua como rodada 10
  });

  it("com 11 jogadores, rodadas 1..9 seguem normais", () => {
    for (let round = 1; round <= 9; round++) {
      expect(roundConfig(round, 11).cardsDealt).toBe(round);
    }
    expect(maxCardsPerRound(11)).toBe(9);
  });

  it("o baralho nunca acaba: cartas distribuídas + 1 trunfo <= 104", () => {
    for (let players = 6; players <= 11; players++) {
      for (const cfg of partidaSchedule(players)) {
        expect(cfg.cardsDealt * players + 1).toBeLessThanOrEqual(104);
      }
    }
  });
});
