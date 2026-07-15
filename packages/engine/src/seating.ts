import { assertPlayerCount } from "./dealing.js";

// Assentos são 0-based, em ordem de classificação: assento 0 = melhor colocado,
// que senta na cabeça e é o MÃO da rodada 1. A ficha vermelha anda 1 assento
// no sentido horário a cada RODADA.
//
// Consequência com 11 jogadores e 10 rodadas: a ficha passa pelos assentos 0..9
// e o assento 10 (pior colocado) nunca é MÃO naquela partida.
// Com 6 jogadores, a ficha dá a volta (rodada 7 volta ao assento 0).
export function maoSeatForRound(round: number, numPlayers: number): number {
  assertPlayerCount(numPlayers);
  return (round - 1) % numPlayers;
}

// O PÉ (último a prever) é o assento imediatamente anterior ao MÃO no sentido
// horário, ou seja, o último da ordem de previsão daquela rodada.
export function peSeatForRound(round: number, numPlayers: number): number {
  const mao = maoSeatForRound(round, numPlayers);
  return (mao - 1 + numPlayers) % numPlayers;
}

// Ordem de previsão: começa no MÃO e segue horário até o PÉ.
export function predictionOrder(round: number, numPlayers: number): number[] {
  const mao = maoSeatForRound(round, numPlayers);
  return Array.from({ length: numPlayers }, (_, i) => (mao + i) % numPlayers);
}

// Quem PUXA a vaza k (1-based) dentro da rodada: a liderança anda 1 assento
// no sentido horário a cada vaza, começando no MÃO da rodada. NÃO é o vencedor
// da vaza anterior — é rotação por assento.
export function leadSeatForTrick(round: number, trick: number, numPlayers: number): number {
  assertPlayerCount(numPlayers);
  const mao = maoSeatForRound(round, numPlayers);
  return (mao + (trick - 1)) % numPlayers;
}

// Ordem de jogada de uma vaza: começa em quem puxa e segue horário.
export function playOrderForTrick(round: number, trick: number, numPlayers: number): number[] {
  const lead = leadSeatForTrick(round, trick, numPlayers);
  return Array.from({ length: numPlayers }, (_, i) => (lead + i) % numPlayers);
}
