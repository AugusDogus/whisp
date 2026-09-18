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

### Automatic production migrations

Vercel applies committed Drizzle migrations before every production build, outside
Turbo's build cache. A migration failure stops the deployment. Already-applied
migrations are skipped, so redeployments do not repeat them. No manual database
command is needed after merging a PR.

When changing the schema, run `bun db:generate` and commit the SQL and metadata in
`packages/db/drizzle` with the code change. CI checks that the committed migrations
match the schema. Use a custom Drizzle migration for data transformations. Do not
edit applied migrations; add a forward migration instead.

The initial baseline adopts the existing production tables without replacing
them or their data. Keep future migrations compatible with the running app,
because they run before the new deployment replaces it. `bun db:push` remains a
development tool for disposable databases. Local application builds do not apply
migrations automatically; `bun db:migrate` is available when needed.

### Pull request previews

[The preview workflow](.github/workflows/preview.yml) deploys same-repository
PRs to Vercel with a Turso database branch named `whisp-pr-<number>`.
Fork and Dependabot PRs do not receive preview deployments.

Each branch copies the main database's schema and data using Turso's native
branching API, equivalent to `turso db create whisp-pr-<number> --from-db <main-db>`.
It uses the source database's existing group; no separate preview group is needed.
The workflow then applies the PR's committed Drizzle migrations
and passes the branch's credentials to both the Vercel build and runtime.
Before deploying, initialization clears inherited `push_token` rows in the branch.
A transactional marker makes this a one-time operation per branch, including
existing previews upgraded to this workflow. Later deployments retain tokens
registered by preview devices. The source database is never changed.
Later pushes reuse the branch without copying the source again. Changes to the branch do not
affect the source database and are not merged back into it.
Previews exercise the same migrations that production will apply on merge.
When adopting migrations, recreate older disposable preview databases that had
already received untracked schema changes through `db:push`.

Closing or merging the PR disables new uploads, deletes its completed UploadThing
files, then deletes its database branch. Reopening branches from the current main
database again.
Deployment and cleanup share a concurrency group and run serially. Pending runs
are queued so sweeps cannot replace a waiting deployment or cleanup. Database
tokens do not expire while the PR is open; deleting the database ends access.
Old Vercel deployments remain listed, but their database stops working after
cleanup. UploadThing uses the existing app: upload middleware assigns each preview
file a server-generated `whisp-pr-<number>:<uuid>` custom ID before uploading.
Cleanup lists files directly from UploadThing, so a failed database callback does
not orphan the upload. It never deletes untagged files or another PR's files.
Normal message cleanup checks a preview-only ownership registry before deleting
files, protecting production references inherited from the database branch.

[An hourly sweep](.github/workflows/preview-upload-sweep.yml) catches uploads that
were still in progress when the PR closed. It also discovers remaining
`whisp-pr-<number>` Turso databases, so failed database deletions are retried even
when no uploads remain. It checks the current GitHub PR state
under the same concurrency lock as deployment, skips open/reopened PRs, and retries
cleanup for closed PRs. GitHub can delay scheduled runs; file removal is eventual.
Other services still use the Vercel Preview environment configuration.

#### Mobile preview builds

The EAS `preview` profile sets `APP_VARIANT=preview`. Preview builds use the name
**Whisp Preview**, Android application ID (and iOS bundle ID) `whisp.chat.preview`,
and deep-link scheme `whisp-preview://`. They install alongside production with
separate app data. All PRs share this preview app identity; installing another
preview build replaces the previous preview app, not production.

Set `EXPO_PUBLIC_API_URL` in the EAS **preview** environment to the selected PR's
backend before running `eas build --profile preview --platform android`. The
profile produces an APK. Local builds need `APP_VARIANT=preview` and the same URL
when generating native files and bundling JavaScript. Preview configuration
rejects a missing URL or the production `whisp.chat` URL instead of silently
using production.

Android push delivery still uses Expo's existing FCM setup. Register
`whisp.chat.preview` as an additional Android app in the existing Firebase project
and use its downloaded config as `apps/expo/google-services.preview.json` for local
builds, or as the EAS preview environment's `GOOGLE_SERVICES_JSON` file variable.
The config must include a client matching `whisp.chat.preview`. Associate the
existing project's FCM V1 credentials with the preview application in EAS.
Production keeps its current package and Google Services configuration. iOS
preview builds need provisioning and push credentials for the new bundle ID.

OAuth and navigation read the build's scheme, and the backend accepts both mobile
schemes. Regenerate local native projects when switching variants so the installed
package and intent filters match the selected configuration.

Preview login uses Better Auth's OAuth proxy, as in Ask AMLI. Discord keeps its
registered callback at `https://whisp.chat/api/auth/callback/discord`. Production
relays the encrypted identity back to the preview, where the user and session are
stored. This requires Better Auth 1.6 on both servers; the old 1.3 proxy expects a
shared database. The Expo adapter enables proxying and returns the preview cookie
to `whisp-preview://`. It also preserves the browser state handoff for older APKs.

#### One-time configuration

1. Identify Whisp's main Turso **libSQL** database and its organization.
   Its name must not use the reserved `whisp-pr-` prefix.
2. Add these **repository-level GitHub Actions secrets**:

   | Secret              | Purpose                                                                            |
   | ------------------- | ---------------------------------------------------------------------------------- |
   | `TURSO_API_TOKEN`   | Turso Platform API access to provision/delete databases and create database tokens |
   | `VERCEL_TOKEN`      | Deploy to the Whisp Vercel project                                                 |
   | `UPLOADTHING_TOKEN` | Existing UploadThing app's V7 token, used by previews and file cleanup             |

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
   (auth, etc.). The workflow explicitly passes `UPLOADTHING_TOKEN` and
   `PREVIEW_PR_NUMBER` to preview builds and runtime. No separate UploadThing app
   or Turso Marketplace integration is needed.
   Set the same randomly generated `OAUTH_PROXY_SECRET` (at least 32 characters)
   in Vercel Production and Preview. This is a dedicated proxy encryption key;
   keep it separate from `AUTH_SECRET`. Deploy the updated production proxy before
   testing preview login. No account-schema migration or Discord callback change
   is required.
5. Merge the workflows and helpers into `main` before relying on cleanup.
   Cleanup checks out the current base branch, including for unmerged PRs.
   Scheduled sweeps only run after their workflow reaches the default branch.

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

File API failures stop cleanup before database deletion, leaving uploads disabled
until cleanup is rerun or the PR reopens. Deletion collects all pages before
mutating files and verifies completed files are gone or pending deletion.
Files uploaded before this tracking was installed have no PR tag and are left
untouched. Old deployments also need replacing before they can tag new uploads;
there is no safe automatic way to attribute earlier untagged uploads to a PR.

To verify the lifecycle after setup, open a same-repository PR, check
`/api/health/db` on its preview, push another commit, and close the PR. Confirm the
same database is reused on the push and absent after closure. Upload a preview
file and confirm only that PR's tagged files are removed; production and other
open previews' files must remain. The sweep can also be run manually from Actions.

This follows the lifecycle demonstrated by
[visa-calculator's preview workflow](https://github.com/mankatcheung/visa-calculator/blob/d48b78c21225a4ae44285357d2a1d90527124cfd/.github/workflows/preview.yml),
using the [Turso Platform API](https://docs.turso.tech/api-reference/introduction)
for [native database branching](https://docs.turso.tech/features/branching) and
to distinguish a missing database from a failed cleanup request.

### Discord profile storage

Discord cosmetics are stored in nullable columns on `user`: `discordBannerUrl`,
`discordAccentColor`, `discordAvatarDecorationUrl`, `discordGuildTag`,
`discordGuildBadgeUrl`, `discordNameplateUrl`, `discordPublicFlags`, and
`discordProfileSyncedAt`, plus an internal `discordProfileRevision` used to reject
outdated refresh writes. Colors and public badge flags are integers; the sync
time is a timestamp. Badge labels and display colors are derived when reading.
`auth.discordProfile` reads only the database. When an opened profile has never synced or its saved sync is
at least 24 hours old, the app calls the existing `auth.refreshAvatar` mutation
in `if-stale` mode. The server checks the saved timestamp before contacting
Discord, so all devices share the same freshness check. Syncing and retries run
in the background, without profile sync controls or error messages. Saved
profile details remain visible when syncing fails. Avatar image recovery uses
a forced refresh.

Discord sign-in and refresh share the same validated profile mapping. Refresh
saves the avatar URL, Discord username, and cosmetics in one database update.
A revision check prevents a delayed refresh from overwriting a profile saved
by another refresh or sign-in. Failed Discord requests preserve the saved data;
automatic refresh can retry when the profile is revisited. Existing users need
no bulk backfill: their next successful sign-in or refresh populates the columns.

Avatars, banners, decorations, and nameplates animate only while the profile is
visible and the app is active. System reduced-motion changes take effect live.
Nameplates use an authenticated image endpoint that converts Discord's transparent
VP9 WebM into animated WebP with the bundled FFmpeg binary. The server caches each
converted asset for 24 hours; clients retain the static image during loading or
conversion failures. Conversion has input/output limits, a timeout, and a limit of
two concurrent assets per server instance. No additional schema change is needed.
The Next.js deployment must include the traced `ffmpeg-static/ffmpeg` binary.

Public badges are labels. Discord does not provide profile badge icon URLs in the
User API. Private profile themes and effects are not included.

Before deploying this change against an existing database, apply
`packages/db/migrations/20260918_discord_cosmetics.sql` once, or use the existing
`bun db:push` flow. Do not apply the SQL migration if `db:push` has already added
the columns. The migration adds these columns together in a transaction and
preserves existing users and avatar URLs.

For phone testing, use the PR preview workflow described above. It provisions
the isolated database branch and applies these columns through Drizzle. Set
`EXPO_PUBLIC_API_URL` to that deployment when building Whisp Preview. Do not also
apply the SQL migration to a preview whose schema has already been pushed.

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
