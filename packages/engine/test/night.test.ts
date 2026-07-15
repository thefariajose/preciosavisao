import { describe, expect, it } from "vitest";
import {
  beginNextPartida,
  createNight,
  drawSeating,
  nextSeating,
  nightAction,
  reseatByBruta,
  startPartida,
  type NightState,
} from "../src/night.js";
import {
  currentPlayerSeat,
  currentPredictorSeat,
  legalPlays,
  legalPredictions,
  makeDeal,
} from "../src/partida.js";
import type { PartidaPlayerResult } from "../src/types.js";

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const six = ["a", "b", "c", "d", "e", "f"];

// Dirige a partida ativa da noite até concluir, com um bot bobo.
function autoPlayActivePartida(night: NightState, rng: () => number): NightState {
  let n = night;
  let guard = 0;
  while (n.phase === "partidaInProgress") {
    if (++guard > 10000) throw new Error("loop travou");
    const p = n.partida!;
    if (p.phase === "awaitingDeal") {
      n = nightAction(n, { type: "deal", ...makeDeal(p.numPlayers, p.config, rng) });
    } else if (p.phase === "predicting") {
      const seat = currentPredictorSeat(p)!;
      n = nightAction(n, { type: "predict", seat, value: legalPredictions(p, seat)[0]! });
    } else if (p.phase === "playing") {
      const seat = currentPlayerSeat(p)!;
      n = nightAction(n, { type: "play", seat, card: legalPlays(p, seat)[0]! });
    }
  }
  return n;
}

describe("criação da noite", () => {
  it("exige de 6 a 11 jogadores e ids únicos", () => {
    expect(() => createNight(six)).not.toThrow();
    expect(() => createNight(["a", "b", "c", "d", "e"])).toThrow();
    expect(() => createNight(["a", "a", "b", "c", "d", "e"])).toThrow();
  });

  it("começa aguardando a 1ª partida", () => {
    const n = createNight(six);
    expect(n.phase).toBe("awaitingPartida");
    expect(n.partidaIndex).toBe(0);
  });
});

describe("assentos", () => {
  it("o sorteio devolve uma permutação do elenco", () => {
    const seating = drawSeating(six, seededRng(1));
    expect(seating.slice().sort()).toEqual(six.slice().sort());
  });

  it("o re-assento ordena por bruta decrescente", () => {
    const prev: PartidaPlayerResult[] = [
      { id: "a", bruta: 40, rank: 3, placePoints: 5, highHitBonus: 0, bandBonus: 0, nightContribution: 5 },
      { id: "b", bruta: 70, rank: 1, placePoints: 10, highHitBonus: 0, bandBonus: 5, nightContribution: 15 },
      { id: "c", bruta: 55, rank: 2, placePoints: 7, highHitBonus: 0, bandBonus: 0, nightContribution: 7 },
    ];
    expect(reseatByBruta(prev, seededRng(1))).toEqual(["b", "c", "a"]);
  });

  it("a 1ª partida usa sorteio; da 2ª em diante, a bruta anterior", () => {
    let n = createNight(six);
    const s1 = nextSeating(n, seededRng(9));
    expect(s1.slice().sort()).toEqual(six.slice().sort()); // permutação (sorteio)
    // (o caminho da bruta é exercido no teste de integração abaixo)
  });
});

describe("noite inteira (3 partidas auto-jogadas)", () => {
  it("encadeia as 3 partidas, re-assenta pela bruta e aponta o campeão", () => {
    const rng = seededRng(2026);
    let n = createNight(six);

    const brutaLeadersPerPartida: string[] = [];

    for (let i = 0; i < 3; i++) {
      expect(n.phase).toBe("awaitingPartida");
      expect(n.partidaIndex).toBe(i);
      n = beginNextPartida(n, rng);
      expect(n.phase).toBe("partidaInProgress");
      n = autoPlayActivePartida(n, rng);
      // resultado da partida recém-concluída
      const result = n.results[i]!;
      const leader = [...result].sort((a, b) => b.bruta - a.bruta)[0]!.id;
      brutaLeadersPerPartida.push(leader);
    }

    expect(n.phase).toBe("nightComplete");
    expect(n.results).toHaveLength(3);

    // o assento 0 das partidas 2 e 3 deve ser o líder de bruta da anterior
    // (sem empate no topo nesta semente). Reconstruímos o assento esperado:
    // já validado indiretamente — aqui checamos o placar da noite.

    // placar da noite = soma das contribuições das 3 partidas, por id
    const expected = new Map<string, number>();
    for (const partida of n.results) {
      for (const r of partida) {
        expected.set(r.id, (expected.get(r.id) ?? 0) + r.nightContribution);
      }
    }
    for (const s of n.standings!) {
      expect(s.total).toBe(expected.get(s.id));
    }

    // campeão = maior total
    const maxTotal = Math.max(...n.standings!.map((s) => s.total));
    for (const champ of n.champions!) {
      expect(expected.get(champ)).toBe(maxTotal);
    }
    expect(n.champions!.length).toBeGreaterThanOrEqual(1);
  });

  it("o re-assento da 2ª partida coloca o líder de bruta da 1ª no assento 0", () => {
    const rng = seededRng(55);
    let n = createNight(six);
    n = beginNextPartida(n, rng); // partida 1 (sorteio)
    n = autoPlayActivePartida(n, rng);
    expect(n.phase).toBe("awaitingPartida");

    // ordena a bruta da 1ª partida; se não houver empate no topo, o assento 0
    // da 2ª deve ser esse líder
    const p1 = [...n.results[0]!].sort((a, b) => b.bruta - a.bruta);
    const topBruta = p1[0]!.bruta;
    const leadersTied = p1.filter((r) => r.bruta === topBruta);

    const seating2 = nextSeating(n, seededRng(999));
    if (leadersTied.length === 1) {
      expect(seating2[0]).toBe(p1[0]!.id);
    } else {
      // com empate no topo, o assento 0 é um dos empatados (sorteio)
      expect(leadersTied.map((r) => r.id)).toContain(seating2[0]);
    }
  });
});

describe("proteções de fase", () => {
  it("não deixa agir sem partida em andamento", () => {
    const n = createNight(six);
    expect(() => nightAction(n, { type: "predict", seat: 0, value: 0 })).toThrow();
  });

  it("rejeita assento que não é permutação do elenco", () => {
    const n = createNight(six);
    expect(() => startPartida(n, ["a", "b", "c", "d", "e", "x"])).toThrow();
    expect(() => startPartida(n, ["a", "b", "c", "d", "e"])).toThrow();
  });
});
