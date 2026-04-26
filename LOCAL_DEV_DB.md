# TixFlo Local Dev DB

## Standard local database
TixFlo local development uses plain Docker with a fixed Postgres dev database.

## Defaults
- Host: `localhost`
- Port: `5432`
- Database: `tixflo`
- User: `postgres`
- Password: `postgres`

## Files
- `scripts/db-up.sh`
- `scripts/db-stop.sh`
- `scripts/db-reset.sh`
- `.env.example`

## Commands
### Start database
```bash
npm run db:up
```

### Stop database
```bash
npm run db:stop
```

### Full reset (destroys local dev data)
```bash
npm run db:reset
```

### Apply Prisma schema
```bash
npx prisma db push
```

### Run tests
```bash
npm test -- --runInBand
```

## Recommended workflow
1. `cp .env.example .env` if needed
2. `npm run db:up`
3. `npm run db:push`
4. `npm test -- --runInBand`

## Notes
- Avoid ad hoc `docker run` / `docker rm` flows for local DB setup.
- Use the provided DB scripts so credentials and lifecycle stay consistent.
- If auth drift or schema drift happens, reset with `npm run db:reset` and recreate.
