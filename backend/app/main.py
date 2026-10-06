from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal
from app.routers import (
    auth,
    clients,
    dashboard,
    invoices,
    payroll,
    profile,
    reports,
    settings as settings_router,
    va_portal,
    vas,
    work_logs,
)
from app.services.seed import seed_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Sunny Hue Creatives API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(clients.router)
app.include_router(vas.router)
app.include_router(work_logs.router)
app.include_router(va_portal.router)
app.include_router(dashboard.router)
app.include_router(payroll.router)
app.include_router(reports.router)
app.include_router(invoices.router)
app.include_router(settings_router.router)


@app.get("/health")
def health():
    return {"status": "ok"}
