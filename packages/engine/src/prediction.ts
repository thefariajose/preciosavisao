// Fase de previsão.
// Cada jogador prevê de 0 até o nº de vazas da rodada. A soma de TODAS as
// previsões não pode ser igual ao nº de vazas — é o PÉ (último a prever) quem
// fica obrigado a ajustar. Isso garante que sempre haja pelo menos um erro.

export function isValidPrediction(prediction: number, tricks: number): boolean {
  return Number.isInteger(prediction) && prediction >= 0 && prediction <= tricks;
}

// A trava usa o nº de VAZAS reais (tricks), não o valor da rodada.
// Ex.: 11 jogadores na 10ª rodada → 9 vazas, então a soma não pode dar 9.
export function isValidPredictionSet(predictions: readonly number[], tricks: number): boolean {
  if (!predictions.every((p) => isValidPrediction(p, tricks))) return false;
  const sum = predictions.reduce((a, b) => a + b, 0);
  return sum !== tricks;
}

// Valor PROIBIDO para o PÉ, dada a soma das outras previsões.
// Retorna null se não há valor proibido dentro da faixa [0, tricks]
// (ou seja, o PÉ está livre para escolher qualquer previsão válida).
export function forbiddenPePrediction(sumOthers: number, tricks: number): number | null {
  const forbidden = tricks - sumOthers;
  return forbidden >= 0 && forbidden <= tricks ? forbidden : null;
}

// Previsões legais para o PÉ.
export function legalPePredictions(sumOthers: number, tricks: number): number[] {
  const forbidden = forbiddenPePrediction(sumOthers, tricks);
  const all = Array.from({ length: tricks + 1 }, (_, p) => p);
  return all.filter((p) => p !== forbidden);
}
