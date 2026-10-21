# Railway Deployment Guide — Teams.SHC

Production target: **https://team.sunnyhuecreatives.com**
Railway project: **Team Sunny Hue Creatives** (`963cdb03-9298-4232-afa5-90dd80a7175c`)
Region: **Singapore** for everything (services: `southeast-asia` / `asia-southeast1-eqsg3a`, bucket: `sin`)

## Architecture (all connected)

| Service | Source | Region | Domain |
|---------|--------|--------|--------|
| `web` | `frontend/` (Dockerfile, nginx) | Singapore | `team.sunnyhuecreatives.com` |
| `api` | `backend/` (Dockerfile, FastAPI) | Singapore | `api.team.sunnyhuecreatives.com` |
| `Postgres` | Railway PostgreSQL | Singapore | internal only |
| Bucket `teams-shc-uploads` | Railway Bucket (S3-compatible) | `sin` | internal only |

Connections:
- `web` → `api`: frontend is built with `VITE_API_URL=https://api.team.sunnyhuecreatives.com`
- `api` → `Postgres`: `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `api` → Bucket: `S3_*` variables from the bucket credentials (profile images)

## ✅ Status (Oct 21, 2026) — LIVE in Singapore

All resources created and connected; all deployments `SUCCESS` in `asia-southeast1`:

- `Postgres` (Singapore, volume attached) → `api` via `${{Postgres.DATABASE_URL}}`
- `api` → bucket `teams-shc-uploads` (`sin`) via `AWS_*` variables (S3 roundtrip verified)
- `web` → `api` via `VITE_API_URL=${{api.API_URL}}` (build-time; also draws the canvas edge)
- `api` health: `Uvicorn running`, `GET /health 200`, migrations 001→010 applied, seed complete

**Only remaining step: DNS.** Add these records at the `sunnyhuecreatives.com` DNS provider:

| Type | Name | Value |
|------|------|-------|
| CNAME | `team` | `5837pwtp.up.railway.app` |
| TXT | `_railway-verify.team` | `railway-verify=d9c10bf1af7dddd60ad2e34b8fb115630a8887aecee83c2cdd3b432cc2d1933b` |
| CNAME | `api.team` | `xs1njy55.up.railway.app` |
| TXT | `_railway-verify.api.team` | `railway-verify=e8af9595c48f65a6b1d5db629a6805e9f0665865e5cd02961924200b2feb0521` |

Then https://team.sunnyhuecreatives.com goes live (certificates issue automatically).
Admin first login: `janelaurine@gmail.com` with the `ADMIN_PASSWORD` set in Railway
(change it in Profile after logging in).

Note: the first api deploy failed healthchecks because an IaC `startCommand`
overrode the Dockerfile CMD — the fix (merged in PR #2) uses the Dockerfile CMD with
its `${PORT:-8090}` fallback plus `PYTHONUNBUFFERED=1`.

## 1. Create the resources (CLI, from repo root)

```bash
railway link --project 963cdb03-9298-4232-afa5-90dd80a7175c
railway add --database postgres --service Postgres
railway bucket create teams-shc-uploads --region sin
railway add --service api
railway add --service web
```

## 2. API variables (`railway variables --service api --set …`)

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | *(generate: `openssl rand -hex 32`)* |
| `ADMIN_EMAIL` | `janelaurine@gmail.com` |
| `ADMIN_PASSWORD` | *(strong production password — not the local dev one)* |
| `CORS_ORIGINS` | `https://team.sunnyhuecreatives.com` |
| `APP_URL` | `https://team.sunnyhuecreatives.com` |
| `API_URL` | `https://api.team.sunnyhuecreatives.com` |
| `AGENT_API_KEY` | *(generate: `openssl rand -hex 32`)* |
| `S3_ENDPOINT_URL` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` | from `railway bucket credentials` |
| `RESEND_API_KEY` | optional here — can also be set later in **Settings → Emails** |
| `XAI_API_KEY` | optional (Grok agent) |

Scale to Singapore (already pinned in `backend/railway.toml` too):

```bash
railway service scale --service api southeast-asia=1
```

Deploy: `cd backend && railway up --service api`, then
`railway domain --service api` → generate domain, then add custom domain
`api.team.sunnyhuecreatives.com`.

## 3. Web variables + deploy

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://api.team.sunnyhuecreatives.com` (build-time) |

```bash
railway service scale --service web southeast-asia=1
cd frontend && railway up --service web
railway domain --service web team.sunnyhuecreatives.com
```

## 4. DNS (at the `sunnyhuecreatives.com` DNS provider)

Add the CNAME records Railway shows for each custom domain, typically:

| Type | Name | Value |
|------|------|-------|
| CNAME | `team` | *(Railway target for the `web` service)* |
| CNAME | `api.team` | *(Railway target for the `api` service)* |

Wait for the certificates to be issued (Railway shows "valid" on the domain).

## 5. Verify

1. `https://api.team.sunnyhuecreatives.com/health` → `{"status":"ok"}`
2. `https://team.sunnyhuecreatives.com` → login page loads
3. Log in as admin; seeded clients/VAs appear on first API startup
4. **Settings → Emails → Resend Setup**: paste the Resend API key, set From Email on a
   verified `sunnyhuecreatives.com` sending domain, Save — then send a test from
   **Email Templates**
5. Upload a profile photo and confirm it loads (stored in the bucket)

## Local Docker (development)

```bash
docker compose up --build -d --no-deps api web
```

- Frontend: http://localhost:5190 · API: http://localhost:8090
