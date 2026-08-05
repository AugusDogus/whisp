# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Cursor Cloud specific instructions

### Overview

Whisp is a T3 Turbo monorepo with two apps:
- **`apps/nextjs`** — Next.js 15 backend API server (port 3000)
- **`apps/expo`** — React Native/Expo mobile app (requires physical device or emulator, not runnable in Cloud VM)

### Running services

- **Next.js dev server:** `bun dev:next` (runs Next.js with Turbopack on http://localhost:3000)
- The homepage (`/`) requires a real Turso database connection; it will 500 with placeholder credentials.
- The health endpoint (`/api/health`) works without any external services.

### Code quality commands

All commands are run from the workspace root:
- `bun lint` — oxlint (not ESLint)
- `bun lint:ws` — workspace lint via sherif
- `bun format` — oxfmt format check (`bun format:fix` to auto-fix)
- `bun typecheck` — TypeScript checking across all packages via Turborepo

### Environment setup

- Requires Node.js >= 22.19.0 and Bun 1.2.23 (see `package.json#packageManager`)
- Copy `.env.example` to `.env` and populate values (see `.env.example` for required keys)
- Required env vars for the Next.js server: `DATABASE_URL`, `DATABASE_TOKEN`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, `AUTH_SECRET`, `DISCORD_BOT_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Env validation is skipped when `CI=true` is set (useful for lint/typecheck-only workflows)

### Gotchas

- The linter/formatter is **oxlint/oxfmt** (not ESLint/Prettier). The README references ESLint/Prettier but those have been replaced.
- The `postinstall` script runs `bun lint:ws` (sherif) automatically after `bun install`.
- The Expo app cannot be tested in a headless Cloud VM environment — focus on the Next.js backend for server-side testing.
- `bun dev` starts both Next.js and Expo simultaneously; use `bun dev:next` to start only the backend.
