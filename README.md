# TixFlo (backend) — Phase 1 skeleton

## What’s included
- Express + TypeScript API
- Prisma schema (Postgres)
- Phase 1 endpoints:
  - `POST /v2/orgs`
  - `POST /v2/events`
  - `POST /v2/ticket-types`
  - `POST /v2/orders` (creates ONE order + many tickets + returns ONE access token)
  - `GET /v2/orders/access/:token`
  - `POST /v2/validate-ticket` (atomic "first scan wins" by ticket status)

## Setup
1) Set `DATABASE_URL` in `.env` (Postgres)
2) Run migrations:
   - `npm run prisma:migrate`
3) Start dev server:
   - `npm run dev`

## Notes
- Phase 1 QR uses random `qrToken` per ticket (placeholder). Phase 2+ will switch to signed tokens (HMAC/JWS) for offline verification.
- Order access tokens are generated once and stored hashed.
