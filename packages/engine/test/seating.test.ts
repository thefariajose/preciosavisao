import { describe, expect, it } from "vitest";
import {
  leadSeatForTrick,
  maoSeatForRound,
  peSeatForRound,
  playOrderForTrick,
  predictionOrder,
} from "../src/seating.js";

describe("mão e assentos", () => {
  it("o melhor colocado (assento 0) é MÃO da rodada 1", () => {
    expect(maoSeatForRound(1, 8)).toBe(0);
  });

  it("a ficha anda 1 assento por rodada", () => {
    expect(maoSeatForRound(2, 8)).toBe(1);
    expect(maoSeatForRound(3, 8)).toBe(2);
  });

  it("com 11 jogadores, o assento 10 nunca é MÃO na partida", () => {
    const maos = new Set<number>();
    for (let round = 1; round <= 10; round++) maos.add(maoSeatForRound(round, 11));
    expect(maos.has(10)).toBe(false);
    expect(maos.size).toBe(10); // assentos 0..9
  });

  it("com 6 jogadores, a ficha dá a volta (rodada 7 volta ao assento 0)", () => {
    expect(maoSeatForRound(7, 6)).toBe(0);
  });

  it("o PÉ é o assento imediatamente anterior ao MÃO", () => {
    // rodada 1, mão = 0 → pé = último assento
    expect(peSeatForRound(1, 8)).toBe(7);
    // rodada 3, mão = 2 → pé = 1
    expect(peSeatForRound(3, 8)).toBe(1);
  });

  it("ordem de previsão começa no MÃO e termina no PÉ", () => {
    const order = predictionOrder(3, 6); // mão = 2
    expect(order[0]).toBe(2);
    expect(order[order.length - 1]).toBe(peSeatForRound(3, 6));
    expect(order).toEqual([2, 3, 4, 5, 0, 1]);
  });
});

describe("puxada das vazas (rotação por assento, não por vitória)", () => {
  it("a vaza 1 é puxada pelo MÃO da rodada", () => {
    expect(leadSeatForTrick(3, 1, 8)).toBe(maoSeatForRound(3, 8));
  });

  it("cada vaza seguinte é puxada pelo próximo assento no sentido horário", () => {
    // rodada 1 (mão 0): vaza 1→0, vaza 2→1, vaza 3→2...
    expect(leadSeatForTrick(1, 1, 6)).toBe(0);
    expect(leadSeatForTrick(1, 2, 6)).toBe(1);
    expect(leadSeatForTrick(1, 3, 6)).toBe(2);
  });

  it("a puxada não depende de quem venceu a vaza anterior", () => {
    // É função apenas de (rodada, vaza, nº de jogadores).
    expect(leadSeatForTrick(5, 4, 7)).toBe((maoSeatForRound(5, 7) + 3) % 7);
  });

  it("ordem de jogada da vaza começa em quem puxa", () => {
    const order = playOrderForTrick(1, 2, 6); // puxador = assento 1
    expect(order).toEqual([1, 2, 3, 4, 5, 0]);
  });
});
