"""VA task notices: wording, preferences, deadline reminders, and deep links."""
import unittest
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.models import TaskStatus
from app.services.notification_prefs import va_channel_enabled
from app.services.notifications import notify_task_assigned, notify_task_decision
from app.services.task_deadlines import classify_deadline, due_soon_title, notify_task_deadlines

MANILA = ZoneInfo("Asia/Manila")


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None


class _DB:
    def __init__(self, users=None, tasks=None):
        self.users = list(users or [])
        self.tasks = list(tasks or [])
        self.alerts = []
        self.added = []

    def query(self, model):
        name = getattr(model, "__name__", "")
        if name == "Task":
            return _Query(self.tasks)
        if name == "TaskDeadlineAlert":
            return _Query(self.alerts)
        return _Query(self.users)

    def add(self, obj):
        self.added.append(obj)
        if getattr(obj, "kind", None) and getattr(obj, "due_date", None):
            self.alerts.append(obj)

    def commit(self):
        pass

    def rollback(self):
        pass


def _user(email, name, role="va", prefs=None):
    return SimpleNamespace(
        id=uuid.uuid4(), email=email, display_name=name, role=role, is_active=True,
        notification_preferences=prefs,
    )


class PreferenceTests(unittest.TestCase):
    def test_va_defaults_are_on_and_a_switch_can_turn_email_off(self):
        va = _user("myra@example.com", "Myra", "va")
        self.assertTrue(va_channel_enabled(va, "task_assigned", "email"))
        self.assertTrue(va_channel_enabled(va, "deadline_soon", "popup"))
        va.notification_preferences = {"events": {"task_assigned": {"popup": True, "email": False}}}
        self.assertFalse(va_channel_enabled(va, "task_assigned", "email"))
        self.assertTrue(va_channel_enabled(va, "task_assigned", "popup"))
        admin = _user("jane@example.com", "Jane", "admin", {"events": {"task_assigned": {"email": False}}})
        self.assertTrue(va_channel_enabled(admin, "task_assigned", "email"))

    def test_email_off_skips_the_message_but_the_bell_item_is_still_stored(self):
        va = _user(
            "myra@example.com", "Myra Santos", "va",
            {"events": {"task_assigned": {"popup": False, "email": False}}},
        )
        task = SimpleNamespace(
            id=uuid.uuid4(), assignee_va_id=uuid.uuid4(), title="Inbox triage",
            client=SimpleNamespace(name="Acme"), project=None,
        )
        db = _DB([va])
        with patch("resend.Emails.send") as send, \
                patch("app.services.email._resend_config", return_value=("re_test", "notes@sunnyhue.test", "admin@sunnyhue.test")), \
                patch("app.services.email._log_email"), \
                patch("app.services.notifications.va_user_id", return_value=va.id):
            notify_task_assigned(db, task, actor_name="Jane Laurine Venida", actor_user_id=uuid.uuid4())
        send.assert_not_called()
        self.assertEqual(len(db.added), 1)
        self.assertEqual(db.added[0].event_key, "task_assigned")
        self.assertIn("/va/tasks?task=", db.added[0].link)

    def test_project_link_is_separate_from_the_task_link(self):
        va = _user("myra@example.com", "Myra Santos", "va")
        project_id = uuid.uuid4()
        task = SimpleNamespace(
            id=uuid.uuid4(), assignee_va_id=uuid.uuid4(), title="Inbox triage",
            client=SimpleNamespace(name="Acme"),
            project=SimpleNamespace(id=project_id, name="Calendar"),
        )
        db = _DB([va])
        with patch("resend.Emails.send") as send, \
                patch("app.services.email._resend_config", return_value=("re_test", "notes@sunnyhue.test", "admin@sunnyhue.test")), \
                patch("app.services.email._log_email"), \
                patch("app.services.notifications.va_user_id", return_value=va.id):
            notify_task_assigned(db, task, first_in_project=True, actor_name="Jane Laurine Venida", actor_user_id=uuid.uuid4())
        subjects = {call.args[0]["subject"] for call in send.call_args_list}
        self.assertEqual(subjects, {
            "Jane assigned you a task: Inbox triage",
            "Jane assigned you a project: Calendar",
        })
        html = " ".join(call.args[0]["html"] for call in send.call_args_list)
        self.assertIn(f"/va/tasks?task={task.id}", html)
        self.assertIn(f"/va/projects?project={project_id}", html)

    def test_staff_approval_uses_actor_first_wording(self):
        va = _user("myra@example.com", "Myra Santos", "va")
        task = SimpleNamespace(id=uuid.uuid4(), assignee_va_id=uuid.uuid4(), title="Inbox triage", client=None, project=None)
        db = _DB([va])
        with patch("resend.Emails.send") as send, \
                patch("app.services.email._resend_config", return_value=("re_test", "notes@sunnyhue.test", "admin@sunnyhue.test")), \
                patch("app.services.email._log_email"), \
                patch("app.services.notifications.va_user_id", return_value=va.id):
            notify_task_decision(db, task, approved=False, actor_name="Audrey Reyes", actor_user_id=uuid.uuid4())
        self.assertEqual(send.call_args.args[0]["subject"], "Audrey rejected Inbox triage")


class DeadlineTests(unittest.TestCase):
    def test_window_is_the_24_hours_before_five_pm_manila(self):
        due = date(2026, 11, 5)
        before = datetime(2026, 11, 4, 16, 59, tzinfo=MANILA)
        at_window = datetime(2026, 11, 4, 17, 0, tzinfo=MANILA)
        morning_of = datetime(2026, 11, 5, 9, 0, tzinfo=MANILA)
        past = datetime(2026, 11, 5, 17, 0, tzinfo=MANILA)
        self.assertIsNone(classify_deadline(before, due))
        self.assertEqual(classify_deadline(at_window, due), "due_soon")
        self.assertEqual(classify_deadline(morning_of, due), "due_soon")
        self.assertEqual(classify_deadline(past, due), "overdue")
        self.assertEqual(due_soon_title("Calendar", at_window, due), "Calendar is due tomorrow at 5:00 PM")
        self.assertEqual(due_soon_title("Calendar", morning_of, due), "Calendar is due today at 5:00 PM")

    def test_reminder_and_overdue_each_fire_once_and_a_new_deadline_rearms(self):
        due = date(2026, 11, 5)
        task = SimpleNamespace(
            id=uuid.uuid4(), title="Calendar", due_date=due,
            assignee_va_id=uuid.uuid4(), status=TaskStatus.todo,
        )
        va_id = uuid.uuid4()
        db = _DB(tasks=[task])
        now = datetime(2026, 11, 4, 17, 30, tzinfo=MANILA)
        with patch("app.services.task_deadlines.va_user_id", return_value=va_id), \
                patch("app.services.task_deadlines.push") as push, \
                patch("app.services.task_deadlines.email_user_ids") as email:
            self.assertEqual(notify_task_deadlines(db, now), 1)
            self.assertEqual(notify_task_deadlines(db, now), 0)
            self.assertEqual(push.call_count, 1)
            self.assertEqual(push.call_args.kwargs["event_key"], "deadline_soon")
            self.assertEqual(push.call_args.args[2], "task")
            self.assertIn("due tomorrow at 5:00 PM", push.call_args.args[3])
            later = now + timedelta(days=1)
            self.assertEqual(notify_task_deadlines(db, later), 1)
            self.assertEqual(notify_task_deadlines(db, later), 0)
            self.assertEqual(email.call_count, 2)
            self.assertEqual(email.call_args.kwargs["template_key"], "deadline_overdue")
            task.due_date = date(2026, 11, 8)
            moved = datetime(2026, 11, 7, 17, 5, tzinfo=MANILA)
            self.assertEqual(notify_task_deadlines(db, moved), 1)
            self.assertIn("due tomorrow at 5:00 PM", push.call_args.args[3])


if __name__ == "__main__":
    unittest.main()
