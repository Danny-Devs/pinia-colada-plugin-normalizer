# Contributing

Thanks for your interest in contributing to pinia-colada-plugin-normalizer!

## Prerequisites

- Node.js 22+
- pnpm (latest)

## Setup

```bash
git clone https://github.com/Danny-Devs/pinia-colada-plugin-normalizer.git
cd pinia-colada-plugin-normalizer
pnpm install
```

## Development

```bash
pnpm dev          # Start the playground (Vite dev server)
pnpm test         # Run tests once (Vitest)
pnpm test:watch   # Run tests in watch mode
pnpm typecheck    # TypeScript type checking (tsc --noEmit)
```

## Linting & Formatting

```bash
pnpm lint         # Lint with oxlint
pnpm lint:fix     # Lint and auto-fix
pnpm fmt          # Format with oxfmt
```

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `perf:` — performance improvement
- `docs:` — documentation only
- `chore:` — maintenance (deps, CI, config)
- `test:` — adding or updating tests
- `refactor:` — code change that neither fixes a bug nor adds a feature

## Pull Requests

Before submitting a PR, ensure:

1. All tests pass (`pnpm test`)
2. TypeScript compiles cleanly (`pnpm typecheck`)
3. Linter is clean (`pnpm lint`)

## Architecture

- `AGENTS.md` — codebase overview and conventions for AI-assisted workflows
- `docs/` — VitePress documentation site
- `docs/architecture.md` — internal architecture deep-dive
