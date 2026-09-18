# whisp

Whisp is a simple mobile app for sending ephemeral messages and photos.

## 📦 Tech Stack

- [Expo](https://expo.dev/) - React Native framework with SDK 53
- [Next.js](https://nextjs.org/) 15 - Backend API server
- [tRPC](https://trpc.io/) v11 - Type-safe API layer
- [Better Auth](https://www.better-auth.com/) - Authentication with OAuth support
- [Drizzle ORM](https://orm.drizzle.team/) - Database ORM
- [Turso](https://turso.tech/) - Serverless SQLite database (libSQL)
- [Turborepo](https://turbo.build/) - Monorepo tooling
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Tailwind CSS](https://tailwindcss.com/) & [NativeWind](https://www.nativewind.dev/) - Styling
- [React Native Vision Camera](https://react-native-vision-camera.com/) - Camera capture

## 📁 Project Structure

The monorepo is organized using [Turborepo](https://turborepo.com) and contains:

```text
whisp/
├── apps/
│   ├── expo/              # React Native mobile app
│   │   ├─ Expo SDK 53
│   │   ├─ React Native using React 19
│   │   ├─ Navigation using Expo Router
│   │   ├─ Tailwind using NativeWind
│   │   ├─ Camera capture with react-native-vision-camera
│   │   └─ Typesafe API calls using tRPC
│   └── nextjs/            # Next.js API server
│       ├─ Next.js 15 & React 19
│       ├─ Tailwind CSS & shadcn/ui
│       └─ E2E Typesafe API Server & Client
├── packages/
│   ├── api/               # tRPC v11 router definition
│   ├── auth/              # Better Auth configuration
│   ├── db/                # Drizzle ORM with Turso (libSQL)
│   ├── ui/                # Shared UI components (shadcn/ui)
│   └── validators/        # Shared validation schemas
└── tooling/
    ├── eslint/            # Shared ESLint presets
    ├── prettier/          # Shared Prettier configuration
    ├── tailwind/          # Shared Tailwind configuration
    └── typescript/        # Shared TypeScript configuration
```

## 🛠️ Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed (see `package.json#engines` for required version)
- [Turso](https://turso.tech/) account and database created
- iOS/Android device or simulator/emulator
- Optional: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) or [ngrok](https://ngrok.com/) for OAuth development

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/AugusDogus/whisp
cd whisp

# Install dependencies
bun install
```

### 2. Configure Environment Variables

```bash
# Copy the example env file and fill in your values
cp .env.example .env
```

> **Note:** For OAuth to work with the mobile app in development, you'll need to run a tunnel (Cloudflare Tunnel or ngrok) and set both `LOCAL_URL` and `EXPO_PUBLIC_API_URL` to the tunnel URL. See the [Authentication Setup](#-authentication-setup) section for details.

### 3. Generate Better Auth Schema

```bash
# Generate the Better Auth schema
bun run --filter @acme/auth generate
```

This generates the authentication tables schema in `packages/db/src/auth-schema.ts` based on your Better Auth configuration.

> **Note**: The `auth-cli.ts` file in `packages/auth/script/` is used exclusively for CLI schema generation. For runtime authentication, use `packages/auth/src/index.ts`.

### 4. Push Database Schema

```bash
# Push the Drizzle schema to Turso
bun db:push
```

### 5. Start Development

```bash
# Start everything (Next.js server + Expo)
bun dev
```

That's it! Turborepo will run both the Next.js server and Expo in parallel.

## 🔐 Authentication Setup

### Better Auth with OAuth

This project uses [Better Auth](https://www.better-auth.com/) with OAuth support. For local development with the Expo app, OAuth requires a publicly accessible URL:

#### Option A: Cloudflare Tunnel/ngrok (For OAuth)

Use a tunnel to expose your local server:

```bash
# Cloudflare Tunnel (quick)
cloudflared tunnel --url http://localhost:3000

# OR ngrok
ngrok http 3000
```

Then update your `.env`:

```bash
LOCAL_URL="https://your-tunnel-url.com"
EXPO_PUBLIC_API_URL="https://your-tunnel-url.com"
```

Configure your OAuth provider (e.g., Discord) to use:

- Redirect URI: `https://your-tunnel-url.com/api/auth/callback/discord`

For a persistent tunnel URL, see the [Cloudflare Tunnel setup guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/).

#### Option B: Auth Proxy Plugin (Production)

Better Auth includes an [auth proxy plugin](https://www.better-auth.com/docs/plugins/oauth-proxy) for production deployments. Deploy your Next.js app to get OAuth working in preview and production environments without configuration changes.

#### Option C: Local IP (Not Recommended)

Add your local IP (e.g., `192.168.x.y:3000`) to your OAuth provider settings. Note that this is unreliable as your IP may change.

## 📊 Database Maintenance

### Pull request previews

[The preview workflow](.github/workflows/preview.yml) deploys same-repository
PRs to Vercel with a Turso database branch named `whisp-pr-<number>`.
Fork and Dependabot PRs do not receive preview deployments.

Each branch copies the main database's schema and data using Turso's native
branching API, equivalent to `turso db create whisp-pr-<number> --from-db <main-db>`.
It uses the source database's existing group; no separate preview group is needed.
The workflow then applies the PR's Drizzle schema with `drizzle-kit push --force`
and passes the branch's credentials to both the Vercel build and runtime.
Later pushes reuse the branch without copying the source again, although
destructive schema changes can remove preview data. Changes to the branch do not
affect the source database and are not merged back into it.
Ambiguous schema changes, such as column renames, may require manual resolution
if Drizzle needs an interactive answer.

Closing or merging the PR deletes its branch. Reopening branches from the current
main database again.
Deployment and cleanup share a concurrency group and run serially. Database
tokens do not expire while the PR is open; deleting the database ends access.
Old Vercel deployments remain listed, but their database stops working after
cleanup. Only the Turso database is isolated by this workflow; configure other
services through Vercel's Preview environment.

#### One-time configuration

1. Identify Whisp's main Turso **libSQL** database and its organization.
   Its name must not use the reserved `whisp-pr-` prefix.
2. Add these **repository-level GitHub Actions secrets**:

   | Secret            | Purpose                                                                            |
   | ----------------- | ---------------------------------------------------------------------------------- |
   | `TURSO_API_TOKEN` | Turso Platform API access to provision/delete databases and create database tokens |
   | `VERCEL_TOKEN`    | Deploy to the Whisp Vercel project                                                 |

3. Add these **repository-level GitHub Actions variables**:

   | Variable                | Value                                   |
   | ----------------------- | --------------------------------------- |
   | `TURSO_ORGANIZATION`    | Turso organization slug                 |
   | `TURSO_SOURCE_DATABASE` | Main Turso database name to branch from |
   | `VERCEL_ORG_ID`         | Vercel team/account ID                  |
   | `VERCEL_PROJECT_ID`     | Whisp's Vercel project ID               |

   Keep Turso credentials at repository scope so cleanup can access them without
   an environment approval. Mint a token scoped to the source database's group with
   `read`, `db:create`, `db:delete`, and `db:mint-token` scopes. The platform token
   is never passed to the deployed app.

4. Configure the Vercel project's Root Directory as `apps/nextjs`, with access to
   files outside that directory enabled for the workspace packages. Keep its
   existing build settings and configure the application's other Preview secrets
   (auth, uploads, etc.). No Turso Marketplace integration is needed.
5. Merge the workflow and helper script into `main` before relying on cleanup.
   Cleanup checks out the current base branch, including for unmerged PRs.

[`apps/nextjs/vercel.json`](apps/nextjs/vercel.json) allows automatic Git
deployments only for `main`. GitHub Actions owns preview deployments, preventing
an automatic build from racing ahead of database provisioning. Configure the
secrets and variables before enabling this change. Missing configuration fails
the workflow with an actionable error.

The preview URL appears in the GitHub `preview` environment and workflow summary.
If provisioning or deployment fails, rerun the workflow; an existing database is
reused. If cleanup fails, rerun the closed-PR workflow. Only HTTP 404 (already
absent) is treated as successful cleanup in addition to successful deletions;
authentication, rate-limit, and service errors fail the job. A cleanup rerun after
the PR has reopened skips deletion.

To verify the lifecycle after setup, open a same-repository PR, check
`/api/health/db` on its preview, push another commit, and close the PR. Confirm the
same database is reused on the push and absent after closure.

This follows the lifecycle demonstrated by
[visa-calculator's preview workflow](https://github.com/mankatcheung/visa-calculator/blob/d48b78c21225a4ae44285357d2a1d90527124cfd/.github/workflows/preview.yml),
using the [Turso Platform API](https://docs.turso.tech/api-reference/introduction)
for [native database branching](https://docs.turso.tech/features/branching) and
to distinguish a missing database from a failed cleanup request.

### Scheduled message cleanup

The app includes an automated cleanup system that runs daily via Vercel Cron to prevent the database from growing indefinitely:

- **Soft-deleted messages** (30+ days old) are permanently purged
- **Old unread messages** (90+ days old) are automatically removed

## 🏥 Backend Monitoring

The app includes health check endpoints for uptime monitoring:

- **`/api/health`** - API server uptime check
- **`/api/health/db`** - Database connectivity check

## 🛠️ Available Scripts

```bash
# Development
bun dev                 # Start Next.js + Expo in parallel
bun android             # Start Expo on Android only
bun ios                 # Start Expo on iOS only (coming soon)

# Database
bun db:push             # Push schema changes to Turso
bun db:studio           # Open Drizzle Studio

# Code Quality
bun lint                # Run ESLint across all packages
bun lint:fix            # Fix ESLint errors
bun format              # Check Prettier formatting
bun format:fix          # Fix Prettier formatting
bun typecheck           # Run TypeScript checks

# Building
bun build               # Build all packages
```

---

<sub>Scaffolded with [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo)</sub>

### Preview OAuth

Better Auth 1.6 proxies preview Discord login through the registered production
callback, then creates the session in the preview database. Configure the same
`OAUTH_PROXY_SECRET` (at least 32 random characters) in Production and Preview,
separate from `AUTH_SECRET`. Production must run the updated proxy before preview
login works. The Expo adapter preserves the browser cookie handoff for existing
APKs and returns preview sessions through `whisp-preview://`.
