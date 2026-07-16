import { describe, expect, it } from "vitest";
import * as engine from "../src/index.js";

// Guarda da convenção do §9: todo módulo novo sai pelo barrel. `export *`
// omite nomes em conflito SILENCIOSAMENTE, então checar em runtime é o que
// pega uma colisão — o typecheck sozinho não pega.
describe("barrel", () => {
  it("re-exporta a API do bot sem colisão de nomes", () => {
    for (const name of [
      "chooseBotAction",
      "chooseBotPrediction",
      "chooseBotPlay",
      "cardStrength",
      "unseenPool",
      "expectedTricks",
      "trickDistribution",
      "roundPayoff",
      "TRUMP_BOOST",
      "DEFAULT_BOT_OPTIONS",
    ]) {
      expect(engine, `o barrel não expõe ${name}`).toHaveProperty(name);
    }
  });

  it("dá para jogar uma partida inteira usando só o barrel", () => {
    let s = engine.createPartida(["a", "b", "c", "d", "e", "f"]);
    let seed = 4242;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let guard = 0;
    while (s.phase !== "partidaComplete") {
      if (++guard > 20000) throw new Error("loop travou");
      if (s.phase === "awaitingDeal") {
        s = engine.applyAction(s, { type: "deal", ...engine.makeDeal(6, s.config, rng) });
        continue;
      }
      const seat =
        s.phase === "predicting" ? engine.currentPredictorSeat(s)! : engine.currentPlayerSeat(s)!;
      s = engine.applyAction(s, engine.chooseBotAction(s, seat));
    }
    expect(s.result).toHaveLength(6);
  });
});
