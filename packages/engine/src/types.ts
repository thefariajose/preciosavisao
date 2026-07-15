// Tipos base do motor do Previsão.
// Convenção: tudo aqui é dado puro e serializável. Nenhuma lógica de rede ou UI.

export type Suit = "ouros" | "espadas" | "copas" | "paus";

// Valor da carta já normalizado para comparação: 2..14 (J=11, Q=12, K=13, A=14).
export type RankValue = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  readonly suit: Suit;
  readonly rank: RankValue;
}

// Uma carta jogada numa vaza, com a posição (assento) de quem jogou.
export interface Play {
  readonly seat: number;
  readonly card: Card;
}

// Configuração de uma rodada. Repare na separação entre cartas distribuídas
// e "valor da rodada": com 11 jogadores, a 10ª rodada distribui 9 cartas
// mas vale 10 para efeito de pontuação.
export interface RoundConfig {
  readonly round: number; // 1..10
  readonly cardsDealt: number; // cartas na mão de cada jogador = nº de vazas
  readonly roundValue: number; // valor usado na pontuação (acerto = roundValue + previsão)
  readonly tricks: number; // nº de vazas reais (= cardsDealt), usado na trava do PÉ
}

// Resultado de um jogador numa única rodada.
export interface RoundOutcome {
  readonly prediction: number;
  readonly tricksWon: number;
  readonly roundValue: number;
}

// Entrada para calcular uma partida inteira (10 rodadas) de um jogador.
export interface PlayerPartida {
  readonly id: string;
  readonly rounds: readonly RoundOutcome[]; // 10 rodadas
}

// Resultado calculado de um jogador numa partida.
export interface PartidaPlayerResult {
  readonly id: string;
  readonly bruta: number; // soma das 10 rodadas — NÃO sobe para o placar da noite
  readonly rank: number; // classificação na mesa por bruta (competição padrão)
  readonly placePoints: number; // pontos de lugar derivados do rank
  readonly highHitBonus: number; // soma dos bônus de alta acertada nas 10 rodadas
  readonly bandBonus: number; // bônus por bruta >= 60 (faixas do regulamento)
  readonly nightContribution: number; // placePoints + highHitBonus + bandBonus
}
