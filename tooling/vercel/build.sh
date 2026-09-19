#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# Run outside Turbo's cache on every production build, before publishing code
# that depends on the new schema. Vercel supplies production credentials.
if [[ ${VERCEL_ENV:-} == production ]]; then
  bun packages/db/scripts/migrate.ts
fi

bun run build --filter=@acme/nextjs...
