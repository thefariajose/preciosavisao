import type { Card, RankValue, Suit } from "./types.js";

export const SUITS: readonly Suit[] = ["ouros", "espadas", "copas", "paus"];

// Hierarquia: A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2.
export const RANKS: readonly RankValue[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_LABEL: Record<RankValue, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};

export function cardLabel(card: Card): string {
  return `${RANK_LABEL[card.rank]} de ${card.suit}`;
}

// Duas cartas são idênticas quando têm o mesmo valor E o mesmo naipe.
// Isso É possível aqui, porque o baralho é duplo (104 cartas).
export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

// Baralho completo: 2 x 52 = 104 cartas. Cada carta aparece exatamente duas vezes.
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }
  }
  return deck;
}

export const DECK_SIZE = 104;

// Embaralhamento Fisher-Yates com RNG injetável (determinístico em teste).
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
