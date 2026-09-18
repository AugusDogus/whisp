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
