# Previsão

Implementação digital do **Previsão**, um jogo de cartas de vazas com previsão
(família "Oh Hell" / "Fodinha"). Monorepo:

- **`packages/engine`** — o motor de regras puro (TypeScript, sem UI, sem rede),
  com um bot heurístico de referência. 106 testes.
- **`apps/web`** — protótipo web single-player: um humano contra bots, com
  informação oculta (você só vê a própria mão).

As regras, decisões de projeto e a arquitetura estão em [CLAUDE.md](CLAUDE.md).

## Pré-requisitos

- **Node.js 18+** (testado no 24 LTS). Confira com `node --version`.

## Rodar o protótipo web

```bash
cd apps/web
npm install     # só na primeira vez
npm run dev
```

Abra a URL que aparecer (normalmente `http://localhost:5173/`). `Ctrl+C` para
parar.

- `http://localhost:5173/?turbo` joga **sem os delays** entre jogadas — útil para
  ver uma noite inteira rápido.

### No Windows / PowerShell

Se `npm` der `execução de scripts foi desabilitada` (política do PowerShell
bloqueando o `npm.ps1`), use **`npm.cmd`** no lugar de `npm`:

```powershell
cd apps/web
npm.cmd run dev
```

Ou libere de vez, só para o seu usuário (não exige admin):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

E confira que você está em **`apps/web`** — a pasta `packages/engine` não tem o
script `dev` (é só o motor).

## Rodar os testes do motor

```bash
cd packages/engine
npm install
npm test          # vitest run
npm run typecheck  # tsc --noEmit
```
