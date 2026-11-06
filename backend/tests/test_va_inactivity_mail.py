"""Zero-hours alerts email the VA and project managers. Admins keep the bell only."""
import unittest
from unittest.mock import patch
from uuid import uuid4

from app.services.va_inactivity import inactivity_delivery, inactivity_messages, notify_daily_inactivity


class _Query:
    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return None


class _Db:
    def query(self, *args, **kwargs):
        return _Query()

    def rollback(self):
        return None


class CopyTests(unittest.TestCase):
    def test_va_copy_speaks_to_the_va_and_has_no_em_dash(self):
        words = inactivity_messages("Angeline Edeza", "Nov 6, 2026", no_time=True, no_tasks=True)
        self.assertIn("Angeline Edeza logged no time", words["title"])
        self.assertTrue(words["va_title"].startswith("You logged no time"))
        self.assertIn("Log your hours", words["va_body"])
        for text in words.values():
            self.assertNotIn("\u2014", text)

    def test_tasks_only_copy_does_not_say_no_time(self):
        words = inactivity_messages("Gem", "Nov 6, 2026", no_time=False, no_tasks=True)
        self.assertNotIn("no time", words["va_title"])
        self.assertIn("no tasks", words["va_body"])


class DeliveryTests(unittest.TestCase):
    def test_admin_reviewer_is_belled_and_not_emailed(self):
        admin = uuid4()
        pm = uuid4()
        va = uuid4()
        delivery = inactivity_delivery(admin_ids=[admin], pm_ids=[pm], reviewer_id=admin, va_user_id=va)
        self.assertEqual(delivery["staff_bell"], [admin, pm])
        self.assertEqual(delivery["pm_email"], [pm])
        self.assertEqual(delivery["va_ids"], [va])
        self.assertNotIn(admin, delivery["pm_email"])
        self.assertNotIn(admin, delivery["va_ids"])

    def test_extra_project_manager_reviewer_is_emailed(self):
        admin = uuid4()
        pm = uuid4()
        reviewer = uuid4()
        va = uuid4()
        delivery = inactivity_delivery(admin_ids=[admin], pm_ids=[pm], reviewer_id=reviewer, va_user_id=va)
        self.assertEqual(delivery["pm_email"], [pm, reviewer])
        self.assertIn(reviewer, delivery["staff_bell"])

    def test_missing_va_user_still_skips_admin_email(self):
        admin = uuid4()
        pm = uuid4()
        delivery = inactivity_delivery(admin_ids=[admin], pm_ids=[pm], reviewer_id=None, va_user_id=None)
        self.assertEqual(delivery["pm_email"], [pm])
        self.assertEqual(delivery["va_ids"], [])


class NotifyTests(unittest.TestCase):
    def test_zero_hours_email_goes_to_the_va_and_pm_not_jane(self):
        admin = uuid4()
        pm = uuid4()
        va = uuid4()
        flag = {
            "va_user_id": str(va),
            "reviewer_user_id": str(admin),
            "title": "Angeline logged no time on Nov 6, 2026",
            "body": "Angeline logged no time on Nov 6, 2026.",
            "va_title": "You logged no time on Nov 6, 2026",
            "va_body": "You logged no time on Nov 6, 2026. Log your hours so your timesheet stays current.",
            "link": "/admin/analytics",
            "va_link": "/va/time-log",
        }
        bells: list[list] = []
        emails: list[dict] = []

        def record_push(_db, ids, *_args, **_kwargs):
            bells.append(list(ids))

        def record_email(_db, ids, **kwargs):
            emails.append({"ids": list(ids), **kwargs})

        with (
            patch("app.services.va_inactivity.daily_inactivity_flags", return_value=[flag]),
            patch("app.services.va_inactivity.admin_user_ids", return_value=[admin]),
            patch("app.services.va_inactivity.admin_and_auditor_user_ids", return_value=[admin, pm]),
            patch("app.services.va_inactivity.push", side_effect=record_push),
            patch("app.services.notification_mail.email_user_ids", side_effect=record_email),
        ):
            notify_daily_inactivity(_Db(), None)

        emailed = {uid for call in emails for uid in call["ids"]}
        belled = {uid for call in bells for uid in call}
        self.assertEqual(emailed, {va, pm})
        self.assertNotIn(admin, emailed)
        self.assertIn(admin, belled)
        self.assertIn(va, belled)
        va_mail = next(call for call in emails if va in call["ids"])
        pm_mail = next(call for call in emails if pm in call["ids"])
        self.assertEqual(va_mail["link"], "/va/time-log")
        self.assertEqual(va_mail["template_key"], "inactive_va")
        self.assertEqual(va_mail["link_label"], "Log your time")
        self.assertNotIn("\u2014", va_mail["paragraphs"][0])
        self.assertEqual(pm_mail["link"], "/admin/analytics")
        self.assertIn("Angeline", pm_mail["title"])


if __name__ == "__main__":
    unittest.main()
