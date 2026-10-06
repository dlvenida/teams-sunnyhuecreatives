# Sunny Hue Creatives — Business Management System

Full-stack web application for VA time tracking, payroll, client billing, reports, and invoices.

## Stack

- **Frontend:** React 19 + Vite + TypeScript + Tailwind v4 + Lexical + @react-pdf/renderer + @react-pdf-kit/viewer
- **Backend:** FastAPI + SQLAlchemy + Alembic
- **Database:** PostgreSQL 16
- **Email:** Resend
- **Hosting:** Railway (`teams.sunnyhuecreatives.com`)

## Quick Start (Local)

### Prerequisites

- Docker & Docker Compose
- Node.js 22+ (for local frontend dev without Docker)

### 1. Environment

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

### 2. Run with Docker

```bash
docker compose up --build
```

- Frontend: http://localhost:5190
- API: http://localhost:8090
- API docs: http://localhost:8090/docs

### 3. Default Login

| Role | Email | Password |
|------|-------|----------|
| Admin (Jane) | janelaurine@gmail.com | admin123 |
| VA (Myra) | myra@sunnyhue.local | va2024 |
| VA (Gem) | gem@sunnyhue.local | va2024 |

## Project Structure

```
sunnyhue/
├── backend/          # FastAPI API
├── frontend/         # React SPA
├── docker-compose.yml
├── railway.toml
└── .env.example
```

## Railway Deployment

### Services

1. **PostgreSQL** — Add Railway Postgres plugin, copy `DATABASE_URL`
2. **API** — Deploy from `backend/` using Dockerfile
3. **Web** — Deploy from `frontend/` (build + nginx)

### API Environment Variables

```
DATABASE_URL=postgresql://...
JWT_SECRET=<long-random-string>
ADMIN_EMAIL=janelaurine@gmail.com
ADMIN_PASSWORD=<secure-password>
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=notifications@sunnyhuecreatives.com
ADMIN_NOTIFY_EMAIL=janelaurine@gmail.com
CORS_ORIGINS=https://teams.sunnyhuecreatives.com
APP_URL=https://teams.sunnyhuecreatives.com
```

### Web Environment Variables

```
VITE_API_URL=https://api.teams.sunnyhuecreatives.com
```

### DNS

| Record | Target |
|--------|--------|
| `teams.sunnyhuecreatives.com` | Railway web service |
| `api.teams.sunnyhuecreatives.com` | Railway API service |

## Features

- **VA Portal:** Time log submission with Lexical rich text, auto hour/pay calculation
- **Admin Dashboard:** Profit bar, stat cards, pending approvals, charts
- **All Logs:** Filter, approve/reject/edit/delete, CSV export
- **VA Payroll:** Period calculator with PHP/USD totals, PDF export
- **Client Reports:** Hours-only or with rates, PDF export
- **Invoices:** Generator with billing types, payment methods, history
- **Settings:** Clients, sub-clients, VA accounts, company info
- **Email:** Resend notification on new VA submissions

## Development

### Backend only

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend only

```bash
cd frontend
npm install
npm run dev
```

## License

Private — Sunny Hue Creatives internal use only.
