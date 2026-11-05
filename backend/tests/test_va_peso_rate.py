"""The VA can read the admin USD to PHP rate, and nothing else about pay."""
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException


class VaPesoRateTests(unittest.TestCase):
    def test_va_sees_only_the_rate(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser, require_admin
        from app.models import User, UserRole, VA
        from app.routers.settings import _get_settings, update_settings
        from app.routers.va_portal import my_usd_php_rate
        from app.schemas import SettingsUpdate

        db = SessionLocal()
        previous = _get_settings(db).get("usd_php_rate")
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            va_user = db.query(User).filter(User.role == UserRole.va).first()
            va = db.query(VA).filter(VA.user_id == va_user.id).first()
            self.assertIsNotNone(va)
            update_settings(SettingsUpdate(usd_php_rate=Decimal("58.50")), CurrentUser(user=admin), db)
            payload = my_usd_php_rate(CurrentUser(user=va_user, va_id=va.id), db)
            self.assertEqual(set(payload.keys()), {"usd_php_rate"})
            self.assertEqual(Decimal(payload["usd_php_rate"]), Decimal("58.50"))
            with self.assertRaises(HTTPException) as denied:
                require_admin(CurrentUser(user=va_user, va_id=va.id))
            self.assertEqual(denied.exception.status_code, 403)
        finally:
            update_settings(
                SettingsUpdate(usd_php_rate=Decimal(str(previous)) if previous else None),
                CurrentUser(user=admin),
                db,
            )
            db.close()

    def test_latest_paid_rate_is_the_default_when_settings_are_empty(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser
        from app.models import PayrollRun, User, UserRole, VA
        from app.routers.settings import _get_settings, update_settings
        from app.routers.va_portal import my_usd_php_rate
        from app.schemas import SettingsUpdate

        db = SessionLocal()
        admin = db.query(User).filter(User.role == UserRole.admin).first()
        previous = _get_settings(db).get("usd_php_rate")
        run_id = None
        try:
            va_user = db.query(User).filter(User.role == UserRole.va).first()
            va = db.query(VA).filter(VA.user_id == va_user.id).first()
            update_settings(SettingsUpdate(usd_php_rate=None), CurrentUser(user=admin), db)
            run = PayrollRun(
                va_id=va.id,
                period_start=date(2026, 10, 1),
                period_end=date(2026, 10, 15),
                total_hours=Decimal("1.00"),
                total_pay=Decimal("10.00"),
                currency="USD",
                usd_php_rate=Decimal("57.25"),
                paid_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
            )
            db.add(run)
            db.commit()
            run_id = run.id
            payload = my_usd_php_rate(CurrentUser(user=va_user, va_id=va.id), db)
            self.assertEqual(set(payload.keys()), {"usd_php_rate"})
            self.assertEqual(Decimal(payload["usd_php_rate"]), Decimal("57.25"))
        finally:
            if run_id:
                db.query(PayrollRun).filter(PayrollRun.id == run_id).delete()
                db.commit()
            update_settings(
                SettingsUpdate(usd_php_rate=Decimal(str(previous)) if previous else None),
                CurrentUser(user=admin),
                db,
            )
            db.close()
