"""Weekly pay uses each VA's approved rate, not the $75 company default.

Ivory's Morgan King and Ever After Numbers logs were saved at $75. Her My Rates
are $4.50 and $3.30. Another hourly VA and a PHP package VA must keep their own
amounts. A clock entry that repeats a manual duration stays in review.
"""
import unittest
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal
from types import SimpleNamespace

from app.auth import hash_password
from app.database import SessionLocal
from app.deps import CurrentUser
from app.models import (
    BillingType,
    Client,
    ClientVARole,
    Currency,
    PayType,
    RateStatus,
    User,
    UserRole,
    VA,
    VARate,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import PayrollRequest, WorkLogCreate, WorkLogUpdate
from app.services.va_rates import package_amount_for_window, pay_from_approved_rate
from app.services.work_log_review import hold_open_matches, review_reason_for


DAY = date(2026, 11, 4)
PERIOD = (date(2026, 11, 1), date(2026, 11, 15))


def _log(**kwargs):
    base = dict(
        hours=Decimal("1"),
        va_rate=Decimal("75"),
        va_pay=Decimal("75"),
        status="submitted",
        source="manual",
        entry_mode="duration",
        task_name="Instagram Engagement",
        start_time=None,
        end_time=None,
        task=None,
        task_id=None,
    )
    base.update(kwargs)
    return SimpleNamespace(id=uuid.uuid4(), **base)


class RateMathTests(unittest.TestCase):
    def test_approved_hourly_rate_replaces_the_75_snapshot(self):
        va_id, client_id, other_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        log = SimpleNamespace(va_id=va_id, client_id=client_id, hours=Decimal("9.00"), va_rate=Decimal("75.00"), va_pay=Decimal("675.00"))
        amounts = {(va_id, client_id): ("hourly", Decimal("4.50"))}
        self.assertEqual(pay_from_approved_rate(log, amounts), (Decimal("4.50"), Decimal("40.50")))
        # Another VA's rate, or any amount saved on the log, is not this VA's rate.
        self.assertEqual(
            pay_from_approved_rate(log, {(other_id, client_id): ("hourly", Decimal("120.00"))}),
            (None, Decimal("0.00")),
        )
        self.assertEqual(pay_from_approved_rate(log, {}), (None, Decimal("0.00")))

    def test_one_hour_at_3_30_is_not_75(self):
        va_id, client_id = uuid.uuid4(), uuid.uuid4()
        log = SimpleNamespace(va_id=va_id, client_id=client_id, hours=Decimal("1.00"), va_rate=Decimal("75.00"), va_pay=Decimal("75.00"))
        amounts = {(va_id, client_id): ("hourly", Decimal("3.30"))}
        self.assertEqual(pay_from_approved_rate(log, amounts), (Decimal("3.30"), Decimal("3.30")))

    def test_package_line_does_not_keep_an_hourly_75(self):
        va_id, client_id = uuid.uuid4(), uuid.uuid4()
        log = SimpleNamespace(va_id=va_id, client_id=client_id, hours=Decimal("9.00"), va_rate=Decimal("75.00"), va_pay=Decimal("675.00"))
        rate, pay = pay_from_approved_rate(log, {(va_id, client_id): ("package", Decimal("8400.00"))})
        self.assertEqual(rate, Decimal("8400.00"))
        self.assertEqual(pay, Decimal("0.00"))

    def test_kyla_and_angeline_halves_stay_on_the_package_math(self):
        self.assertEqual(
            package_amount_for_window(Decimal("11333.36"), "biweekly", date(2026, 11, 1), date(2026, 11, 15)),
            Decimal("5666.68"),
        )
        self.assertEqual(
            package_amount_for_window(Decimal("11333.36"), "biweekly", date(2026, 11, 16), date(2026, 11, 30)),
            Decimal("5666.68"),
        )
        self.assertEqual(
            package_amount_for_window(Decimal("8400.00"), "biweekly", date(2026, 11, 1), date(2026, 11, 15)),
            Decimal("4200.00"),
        )
        self.assertEqual(
            package_amount_for_window(Decimal("8400.00"), "biweekly", date(2026, 11, 16), date(2026, 11, 30)),
            Decimal("4200.00"),
        )


class WeeklyTimesheetRateTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.suffix = uuid.uuid4().hex[:8]
        self.user_ids = []
        self.client_ids = []
        self.morgan = self._client("Morgan King")
        self.ever = self._client("Ever After Numbers")
        self.lauren = self._client("Lauren McLane")
        self.angeline_client = self._client("Angeline Client")
        self.ivory_user, self.ivory = self._va("Ivory Dela Pena", Currency.USD)
        self.mara_user, self.mara = self._va("Mara Hourly", Currency.PHP)
        self.angeline_user, self.angeline = self._va("Angeline Package", Currency.PHP)
        self.admin = self._staff("Jane Admin", UserRole.admin)
        self.pm = self._staff("Leah PM", UserRole.auditor)
        self._rate(self.ivory, self.morgan, PayType.hourly, Currency.USD, Decimal("4.50"))
        self._rate(self.ivory, self.ever, PayType.hourly, Currency.USD, Decimal("3.30"))
        self._rate(self.ivory, self.lauren, PayType.hourly, Currency.USD, Decimal("5.50"))
        self._rate(self.mara, self.morgan, PayType.hourly, Currency.PHP, Decimal("120.00"))
        self._rate(self.mara, self.ever, PayType.hourly, Currency.PHP, Decimal("90.00"))
        self._rate(self.angeline, self.angeline_client, PayType.package, Currency.PHP, Decimal("8400.00"), "biweekly")
        # Snapshots are the company default, including on the client billable rate of $75.
        self._hours(self.ivory, self.morgan, Decimal("9.00"), Decimal("75.00"), Decimal("675.00"))
        self._hours(self.ivory, self.ever, Decimal("1.00"), Decimal("75.00"), Decimal("75.00"))
        self._hours(self.ivory, self.lauren, Decimal("2.00"), Decimal("5.50"), Decimal("11.00"))
        self._hours(self.mara, self.morgan, Decimal("2.00"), Decimal("75.00"), Decimal("150.00"))
        self._hours(self.mara, self.ever, Decimal("1.00"), Decimal("75.00"), Decimal("75.00"))
        self._hours(self.angeline, self.angeline_client, Decimal("9.00"), Decimal("75.00"), Decimal("675.00"))
        self.db.commit()

    def _client(self, name):
        row = Client(
            name=f"{name} {self.suffix}",
            billing_type=BillingType.hourly,
            default_rate=Decimal("75.00"),
            is_active=True,
        )
        self.db.add(row)
        self.db.flush()
        self.client_ids.append(row.id)
        return row

    def _va(self, name, currency):
        user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.va,
            display_name=name,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.user_ids.append(user.id)
        va = VA(user_id=user.id, name=name, currency=currency, is_active=True)
        self.db.add(va)
        self.db.flush()
        return user, va

    def _staff(self, name, role):
        user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=role,
            display_name=name,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.user_ids.append(user.id)
        return user

    def _rate(self, va, client, pay_type, currency, amount, frequency=None):
        self.db.add(VARate(
            va_id=va.id,
            client_id=client.id,
            pay_type=pay_type,
            currency=currency,
            amount=amount,
            payment_frequency=frequency,
            status=RateStatus.approved,
            reviewed_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        ))

    def _hours(self, va, client, hours, rate, pay):
        self.db.add(WorkLog(
            work_date=DAY,
            va_id=va.id,
            client_id=client.id,
            description_plain="Saved before the rate was read again",
            hours=hours,
            va_rate=rate,
            va_pay=pay,
            status=WorkLogStatus.approved,
            source="manual",
            entry_mode="duration",
        ))

    def tearDown(self):
        self.db.rollback()
        self.db.query(WorkLog).filter(WorkLog.client_id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.query(VARate).filter(VARate.client_id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.query(ClientVARole).filter(ClientVARole.client_id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _earnings(self, user, va):
        from app.routers.va_portal import my_earnings

        return my_earnings(CurrentUser(user=user, va_id=va.id), self.db, PERIOD[0], PERIOD[1])

    def _by_name(self, body, label):
        return next(row for row in body["by_client"] if label in row["client_name"])

    def _entry(self, body, label):
        return next(row for row in body["entries"] if label in row["client_name"])

    def test_ivory_weekly_timesheet_uses_her_approved_rates_not_75(self):
        body = self._earnings(self.ivory_user, self.ivory)
        self.assertEqual(body["currency"], "USD")
        morgan = self._entry(body, "Morgan King")
        ever = self._entry(body, "Ever After Numbers")
        lauren = self._entry(body, "Lauren McLane")
        self.assertEqual(Decimal(morgan["hours"]), Decimal("9.00"))
        self.assertEqual(Decimal(morgan["rate"]), Decimal("4.50"))
        self.assertEqual(Decimal(morgan["pay"]), Decimal("40.50"))
        self.assertEqual(Decimal(ever["hours"]), Decimal("1.00"))
        self.assertEqual(Decimal(ever["rate"]), Decimal("3.30"))
        self.assertEqual(Decimal(ever["pay"]), Decimal("3.30"))
        self.assertEqual(Decimal(lauren["rate"]), Decimal("5.50"))
        self.assertEqual(Decimal(lauren["pay"]), Decimal("11.00"))
        self.assertEqual(Decimal(self._by_name(body, "Morgan King")["earned"]), Decimal("40.50"))
        self.assertEqual(Decimal(self._by_name(body, "Ever After Numbers")["earned"]), Decimal("3.30"))
        self.assertEqual(Decimal(body["range"]["earned"]), Decimal("54.80"))
        blob = str(body)
        self.assertNotIn("75.00", blob)
        self.assertNotIn("675.00", blob)
        self.assertNotIn("120.00", blob)
        self.assertNotIn("4200.00", blob)

    def test_another_hourly_va_keeps_her_own_php_rates(self):
        body = self._earnings(self.mara_user, self.mara)
        self.assertEqual(body["currency"], "PHP")
        morgan = self._entry(body, "Morgan King")
        ever = self._entry(body, "Ever After Numbers")
        self.assertEqual(Decimal(morgan["hours"]), Decimal("2.00"))
        self.assertEqual(Decimal(morgan["rate"]), Decimal("120.00"))
        self.assertEqual(Decimal(morgan["pay"]), Decimal("240.00"))
        self.assertEqual(Decimal(ever["rate"]), Decimal("90.00"))
        self.assertEqual(Decimal(ever["pay"]), Decimal("90.00"))
        self.assertEqual(Decimal(body["range"]["earned"]), Decimal("330.00"))
        blob = str(body)
        self.assertNotIn("4.50", blob)
        self.assertNotIn("3.30", blob)
        self.assertNotIn("75.00", blob)

    def test_php_package_va_is_not_paid_the_75_snapshot_or_another_vas_rate(self):
        body = self._earnings(self.angeline_user, self.angeline)
        self.assertEqual(body["currency"], "PHP")
        client = self._by_name(body, "Angeline Client")
        self.assertEqual(client["pay_type"], "package")
        self.assertEqual(client["currency"], "PHP")
        self.assertEqual(Decimal(client["earned"]), Decimal("4200.00"))
        self.assertEqual(Decimal(body["range"]["earned"]), Decimal("4200.00"))
        entry = self._entry(body, "Angeline Client")
        self.assertEqual(Decimal(entry["pay"]), Decimal("0.00"))
        self.assertNotEqual(Decimal(entry["rate"]), Decimal("75.00"))
        blob = str(body)
        self.assertNotIn("4.50", blob)
        self.assertNotIn("120.00", blob)
        self.assertNotIn("675.00", blob)

    def test_admin_payroll_matches_and_a_project_manager_sees_no_money(self):
        from app.routers.payroll import calculate_payroll

        request = PayrollRequest(va_id=self.ivory.id, period="custom", date_from=PERIOD[0], date_to=PERIOD[1])
        admin = calculate_payroll(request, CurrentUser(user=self.admin), self.db)
        ivory = admin.vas[0]
        self.assertEqual(ivory.currency, Currency.USD)
        self.assertEqual(ivory.total_pay, Decimal("54.80"))
        pays = {entry.client_name: (entry.rate, entry.pay) for entry in ivory.entries}
        morgan = next(item for name, item in pays.items() if "Morgan King" in name)
        ever = next(item for name, item in pays.items() if "Ever After Numbers" in name)
        self.assertEqual(morgan, (Decimal("4.50"), Decimal("40.50")))
        self.assertEqual(ever, (Decimal("3.30"), Decimal("3.30")))

        hidden = calculate_payroll(request, CurrentUser(user=self.pm), self.db)
        self.assertIsNone(hidden.total_usd)
        self.assertIsNone(hidden.total_php)
        for va in hidden.vas:
            self.assertIsNone(va.total_pay)
            self.assertIsNone(va.prev_pay)
            for entry in va.entries:
                self.assertIsNone(entry.rate)
                self.assertIsNone(entry.pay)
            for row in va.by_client:
                self.assertIsNone(row.rate)
                self.assertIsNone(row.pay)
                self.assertIsNone(row.currency)
                self.assertIsNone(row.rate_note)

    def test_every_saved_amount_is_replaced_by_that_vas_rate_or_withheld(self):
        """$75, an old rate, and a client billable rate are not pay. Another VA's rate is not either."""
        experts = self._client("Experts in Wellness")
        old = self._client("Old Frozen Rate")
        billable = self._client("Client Billable")
        self._rate(self.mara, experts, PayType.hourly, Currency.PHP, Decimal("8.00"))
        self._hours(self.ivory, experts, Decimal("3.00"), Decimal("75.00"), Decimal("225.00"))
        self._hours(self.mara, experts, Decimal("3.00"), Decimal("75.00"), Decimal("225.00"))
        self._hours(self.ivory, old, Decimal("2.00"), Decimal("40.00"), Decimal("80.00"))
        self._hours(self.ivory, billable, Decimal("4.00"), Decimal("10.00"), Decimal("40.00"))
        self._hours(self.ivory, self.morgan, Decimal("1.00"), Decimal("12.00"), Decimal("12.00"))
        self.db.commit()

        body = self._earnings(self.ivory_user, self.ivory)
        for label in ("Experts in Wellness", "Old Frozen Rate", "Client Billable"):
            row = self._entry(body, label)
            self.assertTrue(row["rate_missing"], label)
            self.assertIsNone(row["rate"], label)
            self.assertIsNone(row["pay"], label)
            self.assertIn("No approved rate yet", row["rate_note"])
            summary = self._by_name(body, label)
            self.assertTrue(summary["rate_missing"])
            self.assertIsNone(summary["earned"])
        morgan = [row for row in body["entries"] if "Morgan King" in row["client_name"]]
        self.assertEqual(sorted(Decimal(row["pay"]) for row in morgan), [Decimal("4.50"), Decimal("40.50")])
        self.assertTrue(all(Decimal(row["rate"]) == Decimal("4.50") for row in morgan))
        # 9h and the extra 1h at $4.50, plus Ever After $3.30 and Lauren $11.00.
        self.assertEqual(Decimal(body["range"]["earned"]), Decimal("59.30"))
        blob = str(body)
        for leftover in ("225.00", "75.00", "80.00", "12.00", "8.00"):
            self.assertNotIn(leftover, blob, leftover)

        mara = self._earnings(self.mara_user, self.mara)
        own = self._entry(mara, "Experts in Wellness")
        self.assertFalse(own.get("rate_missing"))
        self.assertEqual(Decimal(own["rate"]), Decimal("8.00"))
        self.assertEqual(Decimal(own["pay"]), Decimal("24.00"))

    def test_a_va_cannot_log_time_or_finish_a_clock_log_without_her_rate(self):
        from fastapi import HTTPException

        from app.models import ClockStatus, TimeClockEntry
        from app.routers.timeclock import clock_in, clock_out
        from app.routers.va_portal import submit_work_log
        from app.schemas import ClockInRequest, ClockOutRequest, WorkLogCreate
        from app.services.va_rates import RATE_REQUIRED_MESSAGE

        experts = self._client("Experts in Wellness")
        self.db.add(ClientVARole(client_id=experts.id, va_id=self.ivory.id, role="General VA"))
        self.db.add(ClientVARole(client_id=experts.id, va_id=self.angeline.id, role="General VA"))
        self.db.commit()
        current = CurrentUser(user=self.ivory_user, va_id=self.ivory.id)
        with self.assertRaises(HTTPException) as blocked:
            submit_work_log(WorkLogCreate(
                work_date=DAY,
                client_id=experts.id,
                task_name="Newsletter, Carousel and Blog Scheduling for the Week",
                description_plain="Newsletter draft",
                entry_mode="duration",
                duration_hours=3,
                duration_minutes=0,
            ), current, self.db)
        self.assertEqual(blocked.exception.status_code, 400)
        self.assertEqual(blocked.exception.detail, RATE_REQUIRED_MESSAGE)
        self.assertNotIn("75", blocked.exception.detail)
        self.assertEqual(self.db.query(WorkLog).filter(WorkLog.client_id == experts.id, WorkLog.va_id == self.ivory.id).count(), 0)

        open_rows = self.db.query(TimeClockEntry).filter(
            TimeClockEntry.va_id == self.ivory.id,
            TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]),
        ).all()
        for row in open_rows:
            row.status = "completed"
            row.clock_out = row.clock_out or datetime.now(timezone.utc)
        self.db.commit()
        started = clock_in(ClockInRequest(client_id=experts.id), current, self.db)
        self.assertEqual(str(started.status.value if hasattr(started.status, "value") else started.status), "running")
        with self.assertRaises(HTTPException) as clock_blocked:
            clock_out(ClockOutRequest(
                create_work_log=True,
                client_id=experts.id,
                task_name="Newsletter",
                description="Drafted the newsletter",
            ), current, self.db)
        self.assertEqual(clock_blocked.exception.detail, RATE_REQUIRED_MESSAGE)
        still = self.db.query(TimeClockEntry).filter(TimeClockEntry.id == started.id).one()
        self.assertNotEqual(str(still.status.value if hasattr(still.status, "value") else still.status), "completed")
        self.assertEqual(self.db.query(WorkLog).filter(WorkLog.va_id == self.ivory.id, WorkLog.client_id == experts.id).count(), 0)
        finished = clock_out(ClockOutRequest(create_work_log=False, client_id=experts.id), current, self.db)
        self.assertIsNone(finished.work_log_id)

        self._rate(self.angeline, experts, PayType.package, Currency.PHP, Decimal("8400.00"), "biweekly")
        self.db.commit()
        package_log = submit_work_log(WorkLogCreate(
            work_date=DAY,
            client_id=experts.id,
            task_name="Package work",
            description_plain="Covered by the package",
            entry_mode="duration",
            duration_hours=2,
            duration_minutes=0,
        ), CurrentUser(user=self.angeline_user, va_id=self.angeline.id), self.db)
        self.assertEqual(package_log.va_pay, Decimal("0.00"))
        self.assertNotEqual(package_log.va_rate, Decimal("75.00"))
        self.db.query(TimeClockEntry).filter(TimeClockEntry.id == started.id).delete()
        self.db.commit()


class DuplicateReviewTests(unittest.TestCase):
    def test_clock_versus_manual_and_a_short_extra_ask_for_review(self):
        manual = _log(entry_mode="duration", source="manual", hours=Decimal("0.45"), status="approved")
        clock = _log(entry_mode="range", source="clock", hours=Decimal("0.45"), status="submitted", start_time=time(14, 55), end_time=time(15, 22))
        reason = review_reason_for(clock, [manual, clock])
        self.assertIn("clock entry matches a manual duration", reason)
        self.assertIn("Instagram Engagement", reason)
        self.assertIn("27m", reason)
        self.assertIn("in review", reason)
        self.assertNotIn("was rejected", reason.casefold())

        longer = _log(hours=Decimal("0.42"), status="approved")
        short = _log(hours=Decimal("0.02"), status="submitted")
        short_reason = review_reason_for(short, [longer, short])
        self.assertIn("short entry", short_reason)
        self.assertIn("1m", short_reason)
        self.assertIn("25m", short_reason)
        self.assertIsNone(review_reason_for(longer, [longer, short]))

    def test_a_different_task_is_not_held(self):
        facebook = _log(task_name="Facebook Engagement", hours=Decimal("0.47"), status="approved")
        instagram = _log(task_name="Instagram Engagement", hours=Decimal("0.45"), status="submitted", source="clock", entry_mode="range", start_time=time(14, 12), end_time=time(14, 40))
        self.assertIsNone(review_reason_for(instagram, [facebook, instagram]))

    def setUp(self):
        self.db = SessionLocal()
        self.suffix = uuid.uuid4().hex[:8]
        self.user_ids = []
        self.client_ids = []
        self.client = Client(name=f"Krysten Mack Perez {self.suffix}", billing_type=BillingType.hourly, default_rate=Decimal("10"), is_active=True)
        self.db.add(self.client)
        self.db.flush()
        self.client_ids.append(self.client.id)
        self.user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.va,
            display_name="Kyla Marie",
            is_active=True,
        )
        self.db.add(self.user)
        self.db.flush()
        self.user_ids.append(self.user.id)
        self.va = VA(user_id=self.user.id, name="Kyla Marie", currency=Currency.PHP, is_active=True)
        self.db.add(self.va)
        self.db.flush()
        self.other_user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.va,
            display_name="Other VA",
            is_active=True,
        )
        self.db.add(self.other_user)
        self.db.flush()
        self.user_ids.append(self.other_user.id)
        self.other = VA(user_id=self.other_user.id, name="Other VA", currency=Currency.PHP, is_active=True)
        self.db.add(self.other)
        self.db.flush()
        self.admin = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.admin,
            display_name="Jane Admin",
            is_active=True,
        )
        self.db.add(self.admin)
        self.db.flush()
        self.user_ids.append(self.admin.id)
        self.db.add(ClientVARole(client_id=self.client.id, va_id=self.va.id, role="General VA"))
        self.db.add(VARate(
            va_id=self.va.id,
            client_id=self.client.id,
            pay_type=PayType.hourly,
            currency=Currency.PHP,
            amount=Decimal("10.00"),
            status=RateStatus.approved,
        ))
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        self.db.query(WorkLog).filter(WorkLog.client_id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.query(ClientVARole).filter(ClientVARole.client_id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id.in_(self.client_ids)).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _saved(self, **kwargs):
        row = WorkLog(
            work_date=DAY,
            va_id=kwargs.pop("va_id", self.va.id),
            client_id=self.client.id,
            description_plain=kwargs.pop("description_plain", "Logged work"),
            hours=kwargs.pop("hours"),
            va_rate=Decimal("10.00"),
            va_pay=Decimal("4.50"),
            status=kwargs.pop("status"),
            source=kwargs.pop("source", "manual"),
            entry_mode=kwargs.pop("entry_mode", "duration"),
            task_name=kwargs.pop("task_name", "Instagram Engagement"),
            start_time=kwargs.pop("start_time", None),
            end_time=kwargs.pop("end_time", None),
        )
        self.db.add(row)
        self.db.flush()
        return row

    def test_clock_duplicate_stays_submitted_and_an_old_rejection_stays_rejected(self):
        from app.routers.va_portal import submit_work_log

        approved = self._saved(hours=Decimal("0.45"), status=WorkLogStatus.approved, entry_mode="duration", source="manual")
        already = self._saved(
            hours=Decimal("0.47"),
            status=WorkLogStatus.rejected,
            entry_mode="range",
            source="clock",
            task_name="Facebook Engagement",
            start_time=time(14, 12),
            end_time=time(14, 40),
            description_plain="Already decided",
        )
        other = self._saved(va_id=self.other.id, hours=Decimal("0.45"), status=WorkLogStatus.submitted, entry_mode="duration")
        created = submit_work_log(
            WorkLogCreate(
                work_date=DAY,
                client_id=self.client.id,
                task_name="Instagram Engagement",
                description_plain="Instagram Engagement",
                entry_mode="range",
                start_time=time(14, 55),
                end_time=time(15, 22),
                notes="Instagram Engagement",
            ),
            CurrentUser(user=self.user, va_id=self.va.id),
            self.db,
        )
        self.assertEqual(created.status, WorkLogStatus.submitted)
        self.assertIn("manual duration", created.review_reason or "")
        self.assertNotEqual(created.status, WorkLogStatus.rejected)
        self.db.refresh(approved)
        self.db.refresh(already)
        self.db.refresh(other)
        self.assertEqual(approved.status, WorkLogStatus.approved)
        self.assertEqual(already.status, WorkLogStatus.rejected)
        self.assertIsNone(other.review_reason)

    def test_a_short_log_beside_a_longer_approved_one_is_not_rejected(self):
        from app.routers.va_portal import submit_work_log
        from app.routers.work_logs import update_work_log

        longer = self._saved(hours=Decimal("0.42"), status=WorkLogStatus.submitted, task_name="Instagram Engagement")
        short = submit_work_log(
            WorkLogCreate(
                work_date=DAY,
                client_id=self.client.id,
                task_name="Instagram Engagement",
                description_plain="Quick check",
                entry_mode="duration",
                duration_hours=0,
                duration_minutes=1,
            ),
            CurrentUser(user=self.user, va_id=self.va.id),
            self.db,
        )
        self.assertEqual(short.status, WorkLogStatus.submitted)
        self.assertIsNone(short.review_reason)
        update_work_log(longer.id, WorkLogUpdate(status=WorkLogStatus.approved), CurrentUser(user=self.admin), self.db)
        fresh = self.db.query(WorkLog).filter(WorkLog.id == short.id).one()
        decided = self.db.query(WorkLog).filter(WorkLog.id == longer.id).one()
        self.assertEqual(fresh.status, WorkLogStatus.submitted)
        self.assertIn("short entry", fresh.review_reason or "")
        self.assertEqual(decided.status, WorkLogStatus.approved)
        self.assertIsNone(decided.review_reason)

    def test_hold_helper_never_rejects(self):
        clock = self._saved(
            hours=Decimal("0.45"),
            status=WorkLogStatus.submitted,
            source="clock",
            entry_mode="range",
            start_time=time(14, 55),
            end_time=time(15, 22),
        )
        manual = self._saved(hours=Decimal("0.45"), status=WorkLogStatus.approved)
        hold_open_matches(self.db, clock)
        self.db.commit()
        self.assertEqual(clock.status, WorkLogStatus.submitted)
        self.assertIn("review", clock.review_reason)
        self.assertEqual(manual.status, WorkLogStatus.approved)
