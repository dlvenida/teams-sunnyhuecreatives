# Grok Bot Integration (headless — no UI)

Your Grok Bot controls Teams.SHC through a machine API. Nothing is shown in the app UI.
The bot acts as the first admin user; every action and report generation is audit-logged.

## Setup

1. Generate a key: `openssl rand -hex 32`
2. Set it on the API service: `AGENT_API_KEY=<key>` (docker-compose passes it through; on Railway add it to the API service variables).
3. Restart the API.
4. Give your bot: **Base URL** `https://api.sunnyhuecreatives.com` (local: `http://localhost:8090`) and header **`X-Agent-Key: <key>`** on every request. An admin JWT (Bearer) also works.

## Read endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/agent/status` | Health + auth check (`key_auth_configured`, `grok_configured`) |
| GET | `/agent/context` | Live workspace snapshot (task counts, overdue, due today, blocked, unassigned, pending logs, unpaid invoices, live clock, hours this week) |
| GET | `/agent/entities/{kind}` | ID lookup lists: `clients` · `vas` · `users` · `projects` · `tasks` · `logs` · `invoices` · `payroll_runs`. Optional filters: `status`, `client_id`, `assignee_va_id`, `project_id`, `pending=true` (logs), `limit` (1–200, default 100) |
| GET | `/agent/analytics` | Team activity / auditor view (inactive & low-activity VAs, hours, live clock) |
| GET | `/agent/settings` | Current workspace settings |
| POST | `/agent/ask` | `{"message": "..."}` → data-grounded answer + context (the bot does its own Grok reasoning on top) |
| GET | `/agent/reports/daily?report_date=2026-10-21` | Hours by VA/client, entries, tasks completed, clock hours for the day |
| GET | `/agent/reports/weekly?report_date=2026-10-21` | Same, for the Mon–Sun week containing the date |
| POST | `/agent/reports/generate` | `{"type":"daily"\|"weekly"\|"board"\|"client", "client_id": "...", "year": 2026, "month": 10, "cutoff": 15}` |
| POST | `/agent/actions` | Manage the workspace (below) |
| GET | `/agent/audit?limit=50` | Everything the bot has done (audit trail, newest first, limit 1–200) |

## Actions (`POST /agent/actions`)

Body shape: `{"action": "<name>", "payload": { ... }}`. All UUIDs come from `/agent/entities/{kind}`.

### Tasks
```json
{"action": "create_task", "payload": {"title": "Prepare Q4 report", "client_id": "<uuid>", "assignee_va_id": "<uuid>", "project_id": "<uuid>", "due_date": "2026-10-25", "priority": "high"}}
{"action": "update_task", "payload": {"task_id": "<uuid>", "title": "...", "description": "...", "status": "in_progress", "priority": "high", "client_id": "<uuid>", "project_id": "<uuid>", "sub_client_id": "<uuid>", "assignee_va_id": "<uuid>", "due_date": "2026-10-25", "start_date": "2026-10-22", "estimated_hours": 4}}
{"action": "move_task", "payload": {"task_id": "<uuid>", "status": "in_progress"}}
{"action": "assign_task", "payload": {"task_id": "<uuid>", "assignee_va_id": "<uuid>"}}
{"action": "delete_task", "payload": {"task_id": "<uuid>"}}
{"action": "comment_task", "payload": {"task_id": "<uuid>", "body": "Bot update: ..."}}
{"action": "react_task_comment", "payload": {"comment_id": "<uuid>", "emoji": "👍"}}
```
Status values: `todo` · `in_progress` · `done` (plus any board status the app uses). Priority: `low` · `medium` · `high`. `react_task_comment` toggles the bot's reaction; allowed emoji are the app's standard set (👍 ❤️ 🎉 👀 ✅ 🔥). Adding a reaction notifies the comment author and task participants.

### Projects
```json
{"action": "create_project", "payload": {"name": "New launch", "client_id": "<uuid>", "cadence": "weekly"}}
{"action": "update_project", "payload": {"project_id": "<uuid>", "name": "...", "status": "active"}}
{"action": "delete_project", "payload": {"project_id": "<uuid>"}}
{"action": "comment_project", "payload": {"project_id": "<uuid>", "body": "..."}}
```

### Clients
```json
{"action": "create_client", "payload": {"name": "Acme Co", "billing_type": "hourly", "default_rate": 25}}
{"action": "update_client", "payload": {"client_id": "<uuid>", "name": "...", "billing_type": "monthly", "default_rate": 1500}}
{"action": "archive_client", "payload": {"client_id": "<uuid>"}}
{"action": "restore_client", "payload": {"client_id": "<uuid>"}}
{"action": "add_sub_client", "payload": {"client_id": "<uuid>", "name": "Sub-brand"}}
```
Billing types: `hourly` · `monthly`.

### People (VAs, users, auditors)
```json
{"action": "create_va", "payload": {"name": "Maria Clara", "email": "maria@sunnyhue.local", "password": "...", "currency": "PHP"}}
{"action": "create_user", "payload": {"email": "aud@sunnyhue.local", "password": "...", "role": "auditor", "display_name": "..."}}
{"action": "update_user", "payload": {"user_id": "<uuid>", "name": "...", "job_title": "...", "is_active": true}}
{"action": "set_reviewer", "payload": {"va_id": "<uuid>", "reviewer_user_id": "<uuid>"}}
{"action": "archive_va", "payload": {"va_id": "<uuid>"}}
{"action": "restore_va", "payload": {"va_id": "<uuid>"}}
```
Roles: `admin` · `va` · `auditor`. `set_reviewer` assigns the auditor who reviews a VA (pass `null` reviewer to unassign).

### Work logs
```json
{"action": "create_log", "payload": {"va_id": "<uuid>", "client_id": "<uuid>", "work_date": "2026-10-21", "hours": 3.5, "rate": 8, "description": "...", "status": "approved", "sub_client_id": "<uuid>", "project_id": "<uuid>", "task_id": "<uuid>", "start_time": "09:00", "end_time": "12:30"}}
{"action": "update_log", "payload": {"log_id": "<uuid>", "hours": 4, "description": "...", "work_date": "2026-10-21", "status": "approved", "client_id": "<uuid>"}}
{"action": "delete_log", "payload": {"log_id": "<uuid>"}}
{"action": "approve_log", "payload": {"log_id": "<uuid>"}}
{"action": "reject_log", "payload": {"log_id": "<uuid>"}}
```
Log status: `submitted` · `approved` · `rejected` · `invoiced`. `create_log` defaults: status `approved`, `start_time` 09:00, `end_time` 10:00. VA pay is computed as hours × rate.

### Time clock
```json
{"action": "clock_in", "payload": {"va_id": "<uuid>", "task_id": "<uuid>"}}
{"action": "clock_out", "payload": {"va_id": "<uuid>"}}
```

### Invoices
```json
{"action": "generate_invoice", "payload": {"client_id": "<uuid>", "year": 2026, "month": 10, "cutoff": 15, "billing_type": "hourly", "rate": 25, "payment_method": "wise", "invoice_number": "INV-1042", "bank_details": "...", "payment_terms_days": 7}}
{"action": "mark_invoice_paid", "payload": {"invoice_id": "<uuid>"}}
{"action": "mark_invoice_unpaid", "payload": {"invoice_id": "<uuid>"}}
{"action": "delete_invoice", "payload": {"invoice_id": "<uuid>"}}
```
`generate_invoice` requires `client_id`, `year`, `month`, `cutoff` (15–30), `billing_type`, `rate`, and `payment_method` (`wise` · `paypal` · `bank`). Deleting an invoice releases its logs back to `approved`.

### Payroll
```json
{"action": "payroll_calculate", "payload": {"va_id": "<uuid>", "period": "this_week", "date_from": "2026-10-19", "date_to": "2026-10-25"}}
{"action": "mark_va_paid", "payload": {"va_id": "<uuid>", "period_start": "2026-10-19", "period_end": "2026-10-25", "total_hours": 38.5, "total_pay": 308.00, "currency": "USD", "method": "wise", "notes": "..."}}
{"action": "void_payroll_run", "payload": {"run_id": "<uuid>"}}
```
`payroll_calculate` with no `va_id` covers the whole team. `mark_va_paid` records a payroll run and notifies the VA.

### Comms & settings
```json
{"action": "notify", "payload": {"title": "Heads up", "body": "...", "link": "/admin/tasks", "type": "system", "user_id": "<uuid>", "va_id": "<uuid>", "role": "va", "all": true}}
{"action": "send_email", "payload": {"to": "client@example.com", "subject": "Weekly summary", "title": "Optional heading", "body": "Plain-text body", "cta_label": "Open", "cta_url": "https://..."}}
{"action": "update_settings", "payload": {"company_name": "Sunny Hue Creatives"}}
```
`notify` targets exactly one of `user_id` / `va_id` / `role` / `all`. `send_email` wraps the body in the branded template and is recorded in Email Activity. `update_settings` accepts any settings field (an API key value is never echoed into the audit payload).

## Errors

- `401` — missing/invalid `X-Agent-Key` (and no admin Bearer token)
- `400` — unknown action/entity kind, validation error, or business-rule violation (message in `detail`)
- `404` — referenced entity not found

## Suggested bot routine

- **Morning:** `GET /agent/context` → brief the admin (due today, overdue, who's clocked in).
- **Evening:** `GET /agent/reports/daily` → day summary.
- **Weekly (Mon):** `GET /agent/reports/weekly` → week report per VA/client; `GET /agent/analytics` → flag inactive VAs to their reviewers.
