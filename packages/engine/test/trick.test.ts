import { describe, expect, it } from "vitest";
import {
  canDeclareQuemTemPoe,
  isLegalPlayUnderQuemTemPoe,
  resolveTrickSeat,
} from "../src/trick.js";
import type { Card, Play } from "../src/types.js";

const c = (rank: number, suit: Card["suit"]): Card => ({ rank: rank as Card["rank"], suit });
const play = (seat: number, card: Card): Play => ({ seat, card });

describe("resolução da vaza", () => {
  it("qualquer trunfo vence qualquer carta comum", () => {
    const plays = [
      play(0, c(14, "ouros")), // Ás comum
      play(1, c(2, "espadas")), // 2 de trunfo
    ];
    expect(resolveTrickSeat(plays, "espadas")).toBe(1);
  });

  it("entre trunfos, vence o maior", () => {
    const plays = [
      play(0, c(13, "espadas")),
      play(1, c(14, "espadas")),
      play(2, c(7, "espadas")),
    ];
    expect(resolveTrickSeat(plays, "espadas")).toBe(1);
  });

  it("sem trunfo na mesa, vence a maior carta — naipe é irrelevante", () => {
    // Não há obrigação de seguir naipe: puxa-se copas, mas o maior valor
    // (mesmo em outro naipe comum) leva a vaza.
    const plays = [
      play(0, c(10, "copas")),
      play(1, c(13, "paus")), // K de paus, naipe diferente do puxado
      play(2, c(9, "copas")),
    ];
    expect(resolveTrickSeat(plays, "espadas")).toBe(1);
  });

  it("empate de cartas idênticas: vence quem jogou primeiro (baralho duplo)", () => {
    // Dois Áses de paus — o primeiro jogado leva.
    const plays = [
      play(3, c(14, "paus")),
      play(4, c(14, "paus")),
    ];
    expect(resolveTrickSeat(plays, "espadas")).toBe(3);
  });

  it("empate entre trunfos idênticos: também vence o primeiro", () => {
    const plays = [
      play(2, c(11, "espadas")),
      play(0, c(11, "espadas")),
    ];
    expect(resolveTrickSeat(plays, "espadas")).toBe(2);
  });
});

describe("quem tem põe", () => {
  it("só pode declarar quem tem trunfo E puxa um trunfo", () => {
    const trump = "copas";
    const mao = [c(5, "copas"), c(9, "ouros")];
    expect(canDeclareQuemTemPoe(mao, c(5, "copas"), trump)).toBe(true); // puxa trunfo
    expect(canDeclareQuemTemPoe(mao, c(9, "ouros"), trump)).toBe(false); // tem trunfo mas não puxou
    const semTrunfo = [c(9, "ouros"), c(3, "paus")];
    expect(canDeclareQuemTemPoe(semTrunfo, c(9, "ouros"), trump)).toBe(false);
  });

  it("quem tem trunfo é obrigado a jogar trunfo; quem não tem, joga qualquer carta", () => {
    const trump = "copas";
    const comTrunfo = [c(4, "copas"), c(10, "ouros")];
    expect(isLegalPlayUnderQuemTemPoe(comTrunfo, c(4, "copas"), trump)).toBe(true);
    expect(isLegalPlayUnderQuemTemPoe(comTrunfo, c(10, "ouros"), trump)).toBe(false);
    const semTrunfo = [c(10, "ouros"), c(2, "paus")];
    expect(isLegalPlayUnderQuemTemPoe(semTrunfo, c(10, "ouros"), trump)).toBe(true);
  });
});
