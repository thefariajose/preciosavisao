import { describe, expect, it } from "vitest";
import {
  forbiddenPePrediction,
  isValidPrediction,
  isValidPredictionSet,
  legalPePredictions,
} from "../src/prediction.js";

describe("previsão", () => {
  it("previsão vai de 0 até o nº de vazas", () => {
    expect(isValidPrediction(0, 5)).toBe(true);
    expect(isValidPrediction(5, 5)).toBe(true);
    expect(isValidPrediction(6, 5)).toBe(false);
    expect(isValidPrediction(-1, 5)).toBe(false);
  });

  it("a soma das previsões não pode ser igual ao nº de vazas", () => {
    // 5 vazas, soma 5 → inválido
    expect(isValidPredictionSet([2, 2, 1], 5)).toBe(false);
    // soma 4 → válido
    expect(isValidPredictionSet([2, 1, 1], 5)).toBe(true);
    // soma 6 → válido
    expect(isValidPredictionSet([2, 2, 2], 5)).toBe(true);
  });

  it("a trava usa o nº de VAZAS reais, não o valor da rodada (11 jog., rodada 10)", () => {
    // 9 vazas reais → a soma não pode ser 9 (mesmo a rodada valendo 10).
    expect(isValidPredictionSet([3, 3, 3], 9)).toBe(false);
    expect(isValidPredictionSet([3, 3, 2], 9)).toBe(true);
  });

  it("valor proibido do PÉ = vazas - soma dos outros", () => {
    expect(forbiddenPePrediction(3, 5)).toBe(2); // 5 - 3
    // se o proibido cairia fora da faixa, o PÉ fica livre
    expect(forbiddenPePrediction(0, 5)).toBe(5);
    expect(forbiddenPePrediction(6, 5)).toBeNull(); // 5 - 6 = -1, fora da faixa
  });

  it("o PÉ tem todas as previsões válidas menos a proibida", () => {
    // 5 vazas, outros somam 3 → proibido 2 → legais: 0,1,3,4,5
    expect(legalPePredictions(3, 5)).toEqual([0, 1, 3, 4, 5]);
  });
});
