import { DECK_SIZE } from "./cards.js";
import type { RoundConfig } from "./types.js";

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 11;
export const ROUNDS = 10;

export function assertPlayerCount(numPlayers: number): void {
  if (!Number.isInteger(numPlayers) || numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
    throw new Error(`Número de jogadores deve ser inteiro entre ${MIN_PLAYERS} e ${MAX_PLAYERS}, recebido: ${numPlayers}`);
  }
}

// Máximo de cartas por jogador numa rodada, dado o baralho de 104 e 1 carta
// virada para o trunfo. Nunca passa de 10 (só há 10 rodadas).
// Consequência: com 11 jogadores, floor(103/11) = 9 → a 10ª rodada dá 9 cartas.
export function maxCardsPerRound(numPlayers: number): number {
  assertPlayerCount(numPlayers);
  const byDeck = Math.floor((DECK_SIZE - 1) / numPlayers);
  return Math.min(ROUNDS, byDeck);
}

// Configuração de uma rodada. O valor da rodada é sempre o número da rodada;
// só as cartas distribuídas (e portanto as vazas) podem ser limitadas.
export function roundConfig(round: number, numPlayers: number): RoundConfig {
  assertPlayerCount(numPlayers);
  if (!Number.isInteger(round) || round < 1 || round > ROUNDS) {
    throw new Error(`Rodada deve ser inteiro entre 1 e ${ROUNDS}, recebido: ${round}`);
  }
  const cardsDealt = Math.min(round, maxCardsPerRound(numPlayers));
  return {
    round,
    cardsDealt,
    roundValue: round,
    tricks: cardsDealt,
  };
}

// Todas as 10 configurações de rodada para uma mesa.
export function partidaSchedule(numPlayers: number): RoundConfig[] {
  return Array.from({ length: ROUNDS }, (_, i) => roundConfig(i + 1, numPlayers));
}
