# Grok Bot Integration (headless — no UI)

Your Grok Bot controls Teams.SHC through a machine API. Nothing is shown in the app UI.

## Setup

1. Generate a key: `openssl rand -hex 32`
2. Set it on the API service: `AGENT_API_KEY=<key>` (docker-compose passes it through; on Railway add it to the API service variables).
3. Restart the API.
4. Give your bot: **Base URL** `https://api.teams.sunnyhuecreatives.com` (local: `http://localhost:8090`) and header **`X-Agent-Key: <key>`** on every request. An admin JWT (Bearer) also works.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/agent/status` | Health + auth check |
| GET | `/agent/context` | Live workspace snapshot (task counts, overdue, due today, blocked, unassigned, pending logs, unpaid invoices, live clock, hours this week) |
| POST | `/agent/ask` | `{"message": "..."}` → data-grounded answer + context (the bot does its own Grok reasoning on top) |
| GET | `/agent/reports/daily?report_date=2026-10-21` | Hours by VA/client, entries, tasks completed, clock hours for the day |
| GET | `/agent/reports/weekly?report_date=2026-10-21` | Same, for the Mon–Sun week containing the date |
| POST | `/agent/reports/generate` | `{"type":"daily"\|"weekly"\|"board"\|"client", "client_id": "...", "year": 2026, "month": 10}` |
| POST | `/agent/actions` | Manage the workspace (below) |
| GET | `/agent/audit` | Everything the bot has done (audit trail) |

## Actions (`POST /agent/actions`)

```json
{"action": "create_task", "payload": {"title": "Prepare Q4 report", "client_id": "<uuid>", "assignee_va_id": "<uuid>", "due_date": "2026-10-25", "priority": "high"}}
{"action": "move_task", "payload": {"task_id": "<uuid>", "status": "in_progress"}}
{"action": "assign_task", "payload": {"task_id": "<uuid>", "assignee_va_id": "<uuid>"}}
{"action": "comment_task", "payload": {"task_id": "<uuid>", "body": "Bot update: ..."}}
{"action": "create_project", "payload": {"name": "New launch", "client_id": "<uuid>", "cadence": "weekly"}}
{"action": "approve_log", "payload": {"log_id": "<uuid>"}}
{"action": "reject_log", "payload": {"log_id": "<uuid>"}}
```

IDs: get client/VA/project/task IDs from `GET /agent/context`, `GET /tasks`, `GET /projects`, `GET /clients` (all accept the same `X-Agent-Key`? — no: those app endpoints need an admin JWT. For bot-only flows use `/agent/context` plus the IDs returned by `/agent/actions`.)

Every action + report generation is recorded in `/agent/audit`.

## Suggested bot routine

- **Morning:** `GET /agent/context` → brief the admin (due today, overdue, who's clocked in).
- **Evening:** `GET /agent/reports/daily` → day summary.
- **Weekly (Mon):** `GET /agent/reports/weekly` → week report per VA/client.
