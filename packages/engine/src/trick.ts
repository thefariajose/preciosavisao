import type { Card, Play, Suit } from "./types.js";

export function isTrump(card: Card, trump: Suit): boolean {
  return card.suit === trump;
}

// Resolve uma vaza e retorna o ÍNDICE (na ordem de jogada) da carta vencedora.
// Regras:
//  1. Se há qualquer trunfo na mesa, o maior trunfo vence.
//  2. Sem trunfo, vence a maior carta — naipe é irrelevante entre não-trunfos.
//  3. Empate de valor idêntico (baralho duplo!): vence quem jogou PRIMEIRO.
//
// "plays" está na ordem de jogada (índice 0 = quem puxou). A regra do "primeiro"
// cai naturalmente ao usar comparação estritamente maior (>) na varredura.
export function resolveTrickIndex(plays: readonly Play[], trump: Suit): number {
  if (plays.length === 0) {
    throw new Error("Vaza vazia não tem vencedor.");
  }

  const anyTrump = plays.some((p) => isTrump(p.card, trump));

  let bestIdx = -1;
  let bestRank = -1;

  for (let i = 0; i < plays.length; i++) {
    const card = plays[i]!.card;
    const eligible = anyTrump ? isTrump(card, trump) : true;
    if (!eligible) continue;
    // Estritamente maior garante que, em empate, o primeiro jogado permaneça.
    if (card.rank > bestRank) {
      bestRank = card.rank;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// Conveniência: retorna o assento vencedor.
export function resolveTrickSeat(plays: readonly Play[], trump: Suit): number {
  const idx = resolveTrickIndex(plays, trump);
  return plays[idx]!.seat;
}

// Legalidade sob "Quem tem Põe": ao declarar, o puxador PRECISA jogar um trunfo
// (por isso só pode declarar quem tem trunfo). Todos os demais que tenham trunfo
// na mão são obrigados a jogar trunfo; quem não tem, joga qualquer carta.
export function canDeclareQuemTemPoe(leaderHand: readonly Card[], leaderCard: Card, trump: Suit): boolean {
  const hasTrump = leaderHand.some((c) => isTrump(c, trump));
  return hasTrump && isTrump(leaderCard, trump);
}

export function isLegalPlayUnderQuemTemPoe(hand: readonly Card[], played: Card, trump: Suit): boolean {
  const hasTrump = hand.some((c) => isTrump(c, trump));
  if (!hasTrump) return true; // sem trunfo, joga o que quiser
  return isTrump(played, trump); // com trunfo, é obrigado a jogar trunfo
}
