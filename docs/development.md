# Development

[Back to README](../README.md) · [Operations](operations.md)

## 🛠️ Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed (see `package.json#packageManager` for the pinned version)
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

## 🛠️ Available Scripts

```bash
# Development
bun dev                 # Start Next.js + Expo in parallel
bun android             # Run the Android app
bun ios                 # Run the iOS app

# Database
bun db:push             # Push schema changes to Turso
bun db:studio           # Open Drizzle Studio

# Code Quality
bun lint                # Run Oxlint across the repository
bun lint:fix            # Fix Oxlint errors
bun format              # Check formatting with Oxfmt
bun format:fix          # Fix formatting with Oxfmt
bun typecheck           # Run TypeScript checks

# Building
bun build               # Build all packages
```
