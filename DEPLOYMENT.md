# Railway Deployment Guide

Deploy Sunny Hue Creatives to `teams.sunnyhuecreatives.com`.

## 1. Create Railway Project

1. Go to [railway.app](https://railway.app) and create a new project
2. Connect your GitHub repo (or deploy from local with `railway up`)

## 2. Add PostgreSQL

1. Click **+ New** → **Database** → **PostgreSQL**
2. Copy the `DATABASE_URL` from the Postgres service variables

## 3. Deploy API Service

1. Click **+ New** → **GitHub Repo** (or Empty Service)
2. Set **Root Directory** to `backend`
3. Railway will detect the Dockerfile automatically
4. Add environment variables:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | (generate a 64-char random string) |
| `ADMIN_EMAIL` | janelaurine@gmail.com |
| `ADMIN_PASSWORD` | (secure password) |
| `RESEND_API_KEY` | re_... |
| `RESEND_FROM_EMAIL` | notifications@sunnyhuecreatives.com |
| `ADMIN_NOTIFY_EMAIL` | janelaurine@gmail.com |
| `CORS_ORIGINS` | https://teams.sunnyhuecreatives.com |
| `APP_URL` | https://teams.sunnyhuecreatives.com |

5. Generate domain: `api.teams.sunnyhuecreatives.com` (or use Railway default + custom domain)

## 4. Deploy Web Service

1. Click **+ New** → **GitHub Repo**
2. Set **Root Directory** to `frontend`
3. Add build variable:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | https://api.teams.sunnyhuecreatives.com |

4. Railway uses `frontend/Dockerfile` for build
5. Generate domain: `teams.sunnyhuecreatives.com`

## 5. DNS Configuration

In your DNS provider for `sunnyhuecreatives.com`:

| Type | Name | Value |
|------|------|-------|
| CNAME | teams | (Railway web service hostname) |
| CNAME | api.teams | (Railway API service hostname) |

Railway provides the exact CNAME targets in each service's **Settings → Networking**.

## 6. Verify Deployment

1. Visit `https://teams.sunnyhuecreatives.com` — login page loads
2. Visit `https://api.teams.sunnyhuecreatives.com/health` — returns `{"status":"ok"}`
3. Login as admin with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`
4. Sample clients and VAs are seeded on first API startup

## 7. Resend Email Setup

1. Create account at [resend.com](https://resend.com)
2. Verify your sending domain (`sunnyhuecreatives.com`)
3. Add API key to Railway API service as `RESEND_API_KEY`
4. VA submissions will email `ADMIN_NOTIFY_EMAIL`

## Local Docker Alternative

```bash
docker compose up --build
```

- Frontend: http://localhost:5190
- API: http://localhost:8090
