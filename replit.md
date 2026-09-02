# Bot Discord Node.js

Bot Discord de gestion complète de teams et de tournois Discord.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- `DISCORD_BOT_TOKEN` — secret requis pour activer le bot Discord
- `DISCORD_GUILD_ID` — optionnel, enregistre les commandes immédiatement sur un serveur
- `STAFF_ROLE_IDS` — optionnel, IDs de rôles Staff séparés par des virgules
- `ARBITER_ROLE_IDS` — optionnel, IDs de rôles arbitres séparés par des virgules

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/discord/` — commandes, panels, permissions, logique tournoi et persistance du bot
- `lib/db/src/schema/index.ts` — table PostgreSQL singleton contenant l’état restaurable du tournoi
- `artifacts/api-server/src/routes/` — routes API existantes, conservées

## Architecture decisions

- Le bot Discord et l’API santé tournent dans le même service pour conserver le workflow existant.
- L’état complet est stocké en JSONB dans PostgreSQL et les mutations sont sérialisées pour éviter les doubles actions concurrentes.
- Le tirage et le lancement sont volontairement deux actions séparées, chacune protégée par une confirmation Staff.
- Les litiges utilisent un thread privé Discord réservé aux membres Staff/arbitres autorisés, sans ajouter de salon texte aux trois salons de base.

## Product

Le bot crée des teams privées, leurs rôles/catégories/salons, gère les inscriptions 4v4/5v5/6v6, check-in, bracket éliminatoire, scores confirmés, litiges arbitres et classement final.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
