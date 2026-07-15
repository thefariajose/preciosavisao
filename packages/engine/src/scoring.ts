import type {
  PartidaPlayerResult,
  PlayerPartida,
  RoundOutcome,
} from "./types.js";

// --- Pontuação por rodada -------------------------------------------------
// Acertou a previsão exata → valor da rodada + previsão. Errou (pra mais ou
// pra menos) → 0. Quem previu 0 e venceu vaza cai automaticamente no "errou".
export function roundScore(outcome: RoundOutcome): number {
  const hit = outcome.tricksWon === outcome.prediction;
  return hit ? outcome.roundValue + outcome.prediction : 0;
}

export function isHit(outcome: RoundOutcome): boolean {
  return outcome.tricksWon === outcome.prediction;
}

// --- Bônus de alta acertada (por rodada) ----------------------------------
// Só vale quando o jogador ACERTA uma previsão >= 4.
export function highHitBonus(outcome: RoundOutcome): number {
  if (!isHit(outcome)) return 0;
  const p = outcome.prediction;
  if (p >= 7) return 10;
  if (p === 6) return 7;
  if (p === 5) return 5;
  if (p === 4) return 4;
  return 0;
}

// --- Bônus por bruta >= 60 (faixas limpas do regulamento) -----------------
export function bandBonus(bruta: number): number {
  if (bruta >= 71) return 10;
  if (bruta >= 66) return 5; // 66..70
  if (bruta >= 61) return 3; // 61..65
  if (bruta >= 60) return 1; // exatamente 60
  return 0;
}

// --- Pontos de lugar (derivados da classificação na partida) --------------
// Índice 0 = 1º lugar. Vai até o 11º lugar.
export const PLACE_POINTS: readonly number[] = [10, 7, 5, 4, 3, 3, 2, 2, 1, 1, 1];

export function placePointsForRank(rank: number): number {
  if (rank < 1) throw new Error(`Rank inválido: ${rank}`);
  const idx = rank - 1;
  return idx < PLACE_POINTS.length ? PLACE_POINTS[idx]! : 0;
}

// Classificação por bruta com "competição padrão": empatados dividem o mesmo
// lugar e o próximo pula. Ex.: dois em 3º → ambos 3º, o próximo é 5º.
export function rankByBruta<T extends { id: string; bruta: number }>(
  players: readonly T[],
): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const p of players) {
    const strictlyGreater = players.filter((o) => o.bruta > p.bruta).length;
    ranks.set(p.id, strictlyGreater + 1);
  }
  return ranks;
}

// --- Partida inteira ------------------------------------------------------
export function computePartida(players: readonly PlayerPartida[]): PartidaPlayerResult[] {
  const withBruta = players.map((p) => ({
    id: p.id,
    bruta: p.rounds.reduce((sum, r) => sum + roundScore(r), 0),
    highHitBonus: p.rounds.reduce((sum, r) => sum + highHitBonus(r), 0),
  }));

  const ranks = rankByBruta(withBruta);

  return withBruta.map((p) => {
    const rank = ranks.get(p.id)!;
    const placePoints = placePointsForRank(rank);
    const band = bandBonus(p.bruta);
    return {
      id: p.id,
      bruta: p.bruta,
      rank,
      placePoints,
      highHitBonus: p.highHitBonus,
      bandBonus: band,
      // A bruta NÃO entra aqui — só pontos de lugar + os dois bônus sobem.
      nightContribution: placePoints + p.highHitBonus + band,
    };
  });
}

// --- Noite (3 partidas) ---------------------------------------------------
export interface NightStanding {
  readonly id: string;
  readonly total: number;
}

// Soma a contribuição de cada jogador ao longo das partidas da noite.
export function computeNight(
  partidas: readonly PartidaPlayerResult[][],
): NightStanding[] {
  const totals = new Map<string, number>();
  for (const partida of partidas) {
    for (const r of partida) {
      totals.set(r.id, (totals.get(r.id) ?? 0) + r.nightContribution);
    }
  }
  return [...totals.entries()]
    .map(([id, total]) => ({ id, total }))
    .sort((a, b) => b.total - a.total);
}

// Campeão(ões) da noite: maior total. Empate → co-campeões (sem desempate).
export function nightChampions(standings: readonly NightStanding[]): string[] {
  if (standings.length === 0) return [];
  const max = Math.max(...standings.map((s) => s.total));
  return standings.filter((s) => s.total === max).map((s) => s.id);
}
