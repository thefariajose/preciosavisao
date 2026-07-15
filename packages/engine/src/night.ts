// Invólucro da NOITE: encadeia 3 partidas com o mesmo elenco.
//
// Regras de assento (uma noite avulsa, sem temporada):
//  - Partida 1: por SORTEIO.
//  - Partidas 2 e 3: ordem pela BRUTA da partida imediatamente anterior
//    (não pelo acumulado). Melhor bruta senta na cabeça (assento 0, MÃO da
//    rodada 1). Empate no re-assento → sorteio, e isso só afeta a ordem de mão.
//
// Placar da noite = soma das contribuições (pontos de lugar + bônus de alta +
// bônus de ≥60) das 3 partidas. A bruta NÃO acumula. Campeão = maior total;
// empate → co-campeões, sem desempate.
//
// (Numa temporada real, a 1ª partida seria semeada pela classificação do
//  campeonato corrido; aqui, isolada, é sorteio. Isso fica para a camada de
//  temporada, fora deste protótipo.)

import { shuffle } from "./cards.js";
import { assertPlayerCount } from "./dealing.js";
import {
  applyAction,
  createPartida,
  type PartidaAction,
  type PartidaState,
} from "./partida.js";
import { computeNight, nightChampions, type NightStanding } from "./scoring.js";
import type { PartidaPlayerResult } from "./types.js";

export const PARTIDAS_PER_NIGHT = 3;

export type NightPhase = "awaitingPartida" | "partidaInProgress" | "nightComplete";

export interface NightState {
  readonly roster: readonly string[]; // elenco fixo da noite
  readonly numPlayers: number;
  partidaIndex: number; // 0..2 (qual das 3 partidas)
  seating: string[]; // assento -> id para a partida ativa/próxima
  partida: PartidaState | null; // sub-máquina em andamento (null entre partidas)
  results: PartidaPlayerResult[][]; // resultados das partidas concluídas
  standings: NightStanding[] | null; // preenchido em nightComplete
  champions: string[] | null; // preenchido em nightComplete
  phase: NightPhase;
}

// --- Assentos (puros, com rng injetável) ---------------------------------

// Sorteio: permutação aleatória do elenco.
export function drawSeating(roster: readonly string[], rng: () => number = Math.random): string[] {
  return shuffle(roster, rng);
}

// Re-assento pela bruta da partida anterior. Empate → desempate aleatório,
// que só muda a ordem de mão, não a pontuação.
export function reseatByBruta(
  previous: readonly PartidaPlayerResult[],
  rng: () => number = Math.random,
): string[] {
  return previous
    .map((r) => ({ id: r.id, bruta: r.bruta, tie: rng() }))
    .sort((a, b) => b.bruta - a.bruta || a.tie - b.tie)
    .map((k) => k.id);
}

// --- Máquina de estados da noite -----------------------------------------

export function createNight(roster: readonly string[]): NightState {
  assertPlayerCount(roster.length);
  if (new Set(roster).size !== roster.length) {
    throw new Error("O elenco não pode ter ids repetidos.");
  }
  return {
    roster: roster.slice(),
    numPlayers: roster.length,
    partidaIndex: 0,
    seating: [],
    partida: null,
    results: [],
    standings: null,
    champions: null,
    phase: "awaitingPartida",
  };
}

// Assento correto para a próxima partida: sorteio na 1ª, ordem pela bruta
// anterior nas seguintes.
export function nextSeating(night: NightState, rng: () => number = Math.random): string[] {
  if (night.phase !== "awaitingPartida") {
    throw new Error(`nextSeating só vale em awaitingPartida (fase: ${night.phase}).`);
  }
  if (night.partidaIndex === 0) return drawSeating(night.roster, rng);
  return reseatByBruta(night.results[night.partidaIndex - 1]!, rng);
}

function isPermutationOfRoster(seating: readonly string[], roster: readonly string[]): boolean {
  if (seating.length !== roster.length) return false;
  if (new Set(seating).size !== seating.length) return false;
  const set = new Set(roster);
  return seating.every((id) => set.has(id));
}

// Inicia a próxima partida com um assento já resolvido.
export function startPartida(night: NightState, seating: readonly string[]): NightState {
  if (night.phase !== "awaitingPartida") {
    throw new Error(`startPartida só vale em awaitingPartida (fase: ${night.phase}).`);
  }
  if (!isPermutationOfRoster(seating, night.roster)) {
    throw new Error("O assento deve ser uma permutação exata do elenco.");
  }
  const n: NightState = structuredClone(night);
  n.seating = seating.slice();
  n.partida = createPartida(seating);
  n.phase = "partidaInProgress";
  return n;
}

// Conveniência: resolve o assento e já começa a partida.
export function beginNextPartida(night: NightState, rng: () => number = Math.random): NightState {
  return startPartida(night, nextSeating(night, rng));
}

// Encaminha uma ação para a partida em andamento. Ao concluir a partida,
// captura o resultado e avança a noite (ou a encerra após a 3ª).
export function nightAction(night: NightState, action: PartidaAction): NightState {
  if (night.phase !== "partidaInProgress" || night.partida === null) {
    throw new Error(`Nenhuma partida em andamento (fase: ${night.phase}).`);
  }
  const n: NightState = structuredClone(night);
  const updated = applyAction(n.partida!, action);

  if (updated.phase === "partidaComplete") {
    n.results.push(updated.result!);
    n.partida = null;
    n.partidaIndex += 1;
    if (n.partidaIndex >= PARTIDAS_PER_NIGHT) {
      n.standings = computeNight(n.results);
      n.champions = nightChampions(n.standings);
      n.phase = "nightComplete";
    } else {
      n.phase = "awaitingPartida";
    }
  } else {
    n.partida = updated;
  }
  return n;
}

// Placar parcial da noite a qualquer momento (soma do que já foi concluído).
export function partialStandings(night: NightState): NightStanding[] {
  return computeNight(night.results);
}
