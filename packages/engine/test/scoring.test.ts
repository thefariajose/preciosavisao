import { describe, expect, it } from "vitest";
import {
  bandBonus,
  computeNight,
  computePartida,
  highHitBonus,
  nightChampions,
  placePointsForRank,
  rankByBruta,
  roundScore,
} from "../src/scoring.js";
import type { PlayerPartida, RoundOutcome } from "../src/types.js";

const r = (roundValue: number, prediction: number, tricksWon: number): RoundOutcome => ({
  roundValue,
  prediction,
  tricksWon,
});

describe("pontuação por rodada", () => {
  it("acerto vale valor da rodada + previsão", () => {
    expect(roundScore(r(7, 5, 5))).toBe(12);
    expect(roundScore(r(3, 0, 0))).toBe(3); // acertar 0 na rodada 3 vale 3
  });

  it("errar (pra mais ou pra menos) zera a rodada", () => {
    expect(roundScore(r(7, 5, 4))).toBe(0);
    expect(roundScore(r(7, 5, 6))).toBe(0);
  });

  it("previsão 0 que vence vaza fura e zera", () => {
    expect(roundScore(r(4, 0, 1))).toBe(0);
  });

  it("11 jogadores, rodada 10: prever 9 e fazer 9 vale 10 + 9 = 19", () => {
    expect(roundScore(r(10, 9, 9))).toBe(19);
    expect(highHitBonus(r(10, 9, 9))).toBe(10);
  });
});

describe("bônus de alta acertada", () => {
  it("segue 4=4, 5=5, 6=7, 7+=10, e só quando acerta", () => {
    expect(highHitBonus(r(4, 4, 4))).toBe(4);
    expect(highHitBonus(r(5, 5, 5))).toBe(5);
    expect(highHitBonus(r(6, 6, 6))).toBe(7);
    expect(highHitBonus(r(7, 7, 7))).toBe(10);
    expect(highHitBonus(r(8, 8, 8))).toBe(10);
    expect(highHitBonus(r(3, 3, 3))).toBe(0); // < 4
    expect(highHitBonus(r(5, 5, 4))).toBe(0); // errou
  });
});

describe("bônus por bruta >= 60 (faixas limpas)", () => {
  it("respeita as fronteiras do regulamento", () => {
    expect(bandBonus(59)).toBe(0);
    expect(bandBonus(60)).toBe(1);
    expect(bandBonus(61)).toBe(3);
    expect(bandBonus(65)).toBe(3);
    expect(bandBonus(66)).toBe(5);
    expect(bandBonus(70)).toBe(5);
    expect(bandBonus(71)).toBe(10);
    expect(bandBonus(120)).toBe(10);
  });
});

describe("pontos de lugar", () => {
  it("segue a tabela 10/7/5/4/3/3/2/2/1/1 e o 11º = 1", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(placePointsForRank)).toEqual([
      10, 7, 5, 4, 3, 3, 2, 2, 1, 1, 1,
    ]);
  });
});

describe("classificação por bruta (competição padrão)", () => {
  it("dois 3º lugares: ambos pegam o 3º e o próximo é o 5º", () => {
    const ranks = rankByBruta([
      { id: "a", bruta: 50 },
      { id: "b", bruta: 45 },
      { id: "c", bruta: 40 },
      { id: "d", bruta: 40 },
      { id: "e", bruta: 20 },
    ]);
    expect(ranks.get("c")).toBe(3);
    expect(ranks.get("d")).toBe(3);
    expect(ranks.get("e")).toBe(5); // pula o 4º
    // pontos de lugar correspondentes
    expect(placePointsForRank(ranks.get("c")!)).toBe(5);
    expect(placePointsForRank(ranks.get("e")!)).toBe(3);
  });
});

describe("partida inteira", () => {
  const players: PlayerPartida[] = [
    {
      id: "ana",
      rounds: [r(10, 7, 7), r(9, 4, 4), r(8, 5, 5), r(6, 2, 2), r(5, 1, 1), r(4, 0, 0)],
      // bruta = 17+13+13+8+6+4 = 61 → band 3; highHit = 10+4+5 = 19
    },
    {
      id: "bia",
      rounds: [r(10, 0, 0), r(9, 0, 0), r(8, 0, 0), r(7, 0, 0), r(6, 0, 0)],
      // bruta = 40, sem bônus
    },
    {
      id: "cadu",
      rounds: [r(10, 0, 0), r(9, 0, 0), r(8, 0, 0), r(7, 0, 0), r(6, 0, 0)],
      // bruta = 40 (empata com bia)
    },
    {
      id: "dan",
      rounds: [r(10, 0, 0), r(9, 0, 0), r(1, 0, 0)],
      // bruta = 20
    },
  ];

  const result = computePartida(players);
  const byId = Object.fromEntries(result.map((p) => [p.id, p]));

  it("calcula a bruta corretamente", () => {
    expect(byId.ana!.bruta).toBe(61);
    expect(byId.bia!.bruta).toBe(40);
    expect(byId.dan!.bruta).toBe(20);
  });

  it("aplica bônus de bruta e de alta", () => {
    expect(byId.ana!.bandBonus).toBe(3);
    expect(byId.ana!.highHitBonus).toBe(19);
    expect(byId.bia!.bandBonus).toBe(0);
    expect(byId.bia!.highHitBonus).toBe(0);
  });

  it("ranqueia e dá pontos de lugar (empate bia/cadu no 2º)", () => {
    expect(byId.ana!.rank).toBe(1);
    expect(byId.bia!.rank).toBe(2);
    expect(byId.cadu!.rank).toBe(2);
    expect(byId.dan!.rank).toBe(4); // pula o 3º
    expect(byId.bia!.placePoints).toBe(7);
    expect(byId.dan!.placePoints).toBe(4);
  });

  it("a bruta NÃO entra na contribuição da noite — só lugar + bônus", () => {
    // ana: lugar 10 + alta 19 + faixa 3 = 32 (a bruta 61 fica de fora)
    expect(byId.ana!.nightContribution).toBe(32);
    expect(byId.bia!.nightContribution).toBe(7);
    expect(byId.dan!.nightContribution).toBe(4);
  });
});

describe("noite (3 partidas)", () => {
  it("soma as contribuições e aponta o campeão", () => {
    const mk = (id: string, contrib: number) => ({
      id,
      bruta: 0,
      rank: 1,
      placePoints: contrib,
      highHitBonus: 0,
      bandBonus: 0,
      nightContribution: contrib,
    });
    const partidas = [
      [mk("ana", 10), mk("bia", 7)],
      [mk("ana", 5), mk("bia", 4)],
      [mk("ana", 3), mk("bia", 10)],
    ];
    const standings = computeNight(partidas);
    const total = Object.fromEntries(standings.map((s) => [s.id, s.total]));
    expect(total.ana).toBe(18);
    expect(total.bia).toBe(21);
    expect(nightChampions(standings)).toEqual(["bia"]);
  });

  it("empate no total da noite gera co-campeões (sem desempate)", () => {
    const mk = (id: string, contrib: number) => ({
      id,
      bruta: 0,
      rank: 1,
      placePoints: contrib,
      highHitBonus: 0,
      bandBonus: 0,
      nightContribution: contrib,
    });
    const partidas = [[mk("ana", 10), mk("bia", 10), mk("cadu", 3)]];
    const champs = nightChampions(computeNight(partidas));
    expect(champs.sort()).toEqual(["ana", "bia"]);
  });
});
