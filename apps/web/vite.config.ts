import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// O motor é consumido direto do fonte TypeScript (sem passo de build): o esbuild
// do Vite entende a convenção de import ".js" apontando para ".ts" que o engine
// usa, então não precisamos de um dist/ intermediário.
export default defineConfig({
  resolve: {
    alias: {
      "@previsao/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
});
