import { describe, expect, it } from "vitest";
import { buildDeck, sameCard, shuffle, DECK_SIZE } from "../src/cards.js";

describe("baralho", () => {
  it("tem 104 cartas (2 baralhos de 52)", () => {
    expect(buildDeck()).toHaveLength(DECK_SIZE);
  });

  it("contém cartas idênticas em duplicata (mesmo valor e naipe)", () => {
    const deck = buildDeck();
    const asDePaus = deck.filter((c) => c.rank === 14 && c.suit === "paus");
    expect(asDePaus).toHaveLength(2);
    expect(sameCard(asDePaus[0]!, asDePaus[1]!)).toBe(true);
  });

  it("embaralhar preserva exatamente as mesmas cartas", () => {
    const deck = buildDeck();
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const shuffled = shuffle(deck, rng);
    expect(shuffled).toHaveLength(DECK_SIZE);
    // Mesmo multiconjunto de cartas.
    const key = (c: { rank: number; suit: string }) => `${c.rank}-${c.suit}`;
    expect(shuffled.map(key).sort()).toEqual(deck.map(key).sort());
  });
});
