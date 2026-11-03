"""Important events email every recipient role. Routine activity stays in the app."""
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from app.services.email import send_email, send_email_verification, send_va_submission_notification
from app.services.notification_mail import notification_html, send_notification_email
from app.services.notifications import notify_involved_comment, notify_task_assigned, notify_task_updated


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self, users):
        self.users = users
        self.added = []

    def query(self, model):
        return FakeQuery(self.users)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass

    def rollback(self):
        pass


def _user(email, name, role="va"):
    return SimpleNamespace(id=uuid.uuid4(), email=email, display_name=name, role=role, is_active=True)


class NotificationEmailTests(unittest.TestCase):
    def setUp(self):
        self.send = patch("resend.Emails.send").start()
        patch("app.services.email._resend_config", return_value=("re_test", "notes@sunnyhue.test", "admin@sunnyhue.test")).start()
        patch("app.services.email._log_email").start()
        self.addCleanup(patch.stopall)

    def test_html_uses_sunny_hue_brand_and_one_link(self):
        html = notification_html(
            "Jane tagged you",
            ["In Calendar.", "Please look at Friday."],
            "http://localhost:5190/va/tasks?task=1",
            "Open in Teams.SHC",
        )
        self.assertIn("Instrument Serif", html)
        self.assertIn("DM Sans", html)
        self.assertIn("#B8325F", html)
        self.assertIn("#E8578A", html)
        self.assertIn("#FDF2F5", html)
        self.assertEqual(html.count('href="http://localhost:5190/va/tasks?task=1"'), 2)
        self.assertNotIn("$", html)
        self.assertNotIn("₱", html)

    def test_assigning_a_task_emails_only_the_owning_va(self):
        va = _user("myra@example.com", "Myra Santos", "va")
        task = SimpleNamespace(
            assignee_va_id=uuid.uuid4(),
            title="Inbox triage",
            client=SimpleNamespace(name="Acme"),
            project=None,
            due_date=None,
            id=uuid.uuid4(),
        )
        with patch("app.services.notifications.va_user_id", return_value=va.id):
            notify_task_assigned(FakeDB([va]), task, actor_name="Jane Laurine Venida", actor_user_id=uuid.uuid4())
        self.send.assert_called_once()
        payload = self.send.call_args.args[0]
        self.assertEqual(payload["to"], ["myra@example.com"])
        self.assertEqual(payload["subject"], "Jane assigned you a task: Inbox triage")
        self.assertIn(f"/va/tasks?task={task.id}", payload["html"])
        self.assertGreaterEqual(payload["html"].count(f"/va/tasks?task={task.id}"), 2)

    def test_a_va_edit_does_not_email_her_and_staff_edits_do(self):
        va = _user("myra@example.com", "Myra Santos", "va")
        task = SimpleNamespace(
            assignee_va_id=uuid.uuid4(),
            title="Inbox triage",
            client=SimpleNamespace(name="Acme"),
            project=None,
            due_date=None,
            id=uuid.uuid4(),
        )
        with patch("app.services.notifications.va_user_id", return_value=va.id):
            notify_task_updated(FakeDB([va]), task, "Moved to In Progress", "Myra", actor_user_id=va.id, actor_is_staff=False)
        self.send.assert_not_called()
        with patch("app.services.notifications.va_user_id", return_value=va.id):
            notify_task_updated(FakeDB([va]), task, "Deadline set to 2026-11-05", "Audrey Reyes", actor_user_id=uuid.uuid4(), actor_is_staff=True)
        self.assertEqual(self.send.call_args.args[0]["subject"], "Audrey updated Inbox triage")
        self.assertEqual(self.send.call_args.args[0]["to"], ["myra@example.com"])

    def test_routine_template_keys_never_reach_resend(self):
        for key in ("log_submitted", "delegation", "reaction", "payroll_paid"):
            self.assertFalse(send_email("va@example.com", "Update", "<p>hi</p>", template_key=key))
        self.send.assert_not_called()
        self.assertFalse(send_va_submission_notification("Myra", "Acme", "2", "2026-11-01", "Drafts"))
        self.send.assert_not_called()

    def test_comment_emails_the_va_with_actor_first_wording(self):
        va = _user("myra@example.com", "Myra Santos", "va")
        notify_involved_comment(
            FakeDB([va]),
            author_name="Jane Laurine Venida",
            author_user_id=uuid.uuid4(),
            comment_body="Please update the captions",
            context_title="Calendar",
            link="/tasks?task=1",
            recipient_ids=[va.id],
        )
        self.send.assert_called_once()
        payload = self.send.call_args.args[0]
        self.assertEqual(payload["to"], ["myra@example.com"])
        self.assertEqual(payload["subject"], "Jane commented: Please update the captions")
        self.assertIn("Please update the captions", payload["html"])
        self.assertIn("/va/tasks?task=1", payload["html"])
        self.assertNotIn("$", payload["html"])

    def test_mention_emails_admin_and_project_manager(self):
        from app.services.comments import notify_mentions

        admin = _user("jane@example.com", "Jane Laurine Venida", "admin")
        pm = _user("audrey@example.com", "Audrey Reyes", "auditor")
        notify_mentions(
            FakeDB([admin, pm]),
            [{"user_id": str(admin.id)}, {"user_id": str(pm.id)}],
            scope_label="a task",
            title="Calendar",
            body="Can you review this",
            link="/tasks?task=9",
            exclude_user_id=None,
            actor_name="Myra Santos",
            verb="tagged",
        )
        self.assertEqual(self.send.call_count, 2)
        subjects = {call.args[0]["subject"] for call in self.send.call_args_list}
        self.assertEqual(subjects, {"Myra tagged you"})
        recipients = {call.args[0]["to"][0] for call in self.send.call_args_list}
        self.assertEqual(recipients, {"jane@example.com", "audrey@example.com"})

    def test_timesheet_rate_and_inactive_events_send(self):
        self.assertTrue(send_notification_email(
            "audrey@example.com",
            "Hi Audrey, Myra submitted her timesheet",
            "Hi Audrey, Myra submitted her timesheet",
            ["2026-10-16 to 2026-10-31. 4.75 hrs, 3 entries."],
            "http://localhost:5190/admin/payroll",
            "Review the timesheet",
            "timesheet_submitted",
        ))
        self.assertTrue(send_notification_email(
            "myra@example.com",
            "Jane approved your timesheet",
            "Jane approved your timesheet",
            ["2026-10-16 to 2026-10-31."],
            "http://localhost:5190/va/payroll",
            "Open your timesheets",
            "timesheet_approved",
        ))
        self.assertTrue(send_notification_email(
            "myra@example.com",
            "Jane rejected your timesheet",
            "Jane rejected your timesheet",
            ["2026-10-16 to 2026-10-31.", "Please add the task names."],
            "http://localhost:5190/va/payroll",
            "Open your timesheets",
            "timesheet_rejected",
        ))
        self.assertTrue(send_notification_email(
            "audrey@example.com",
            "Myra asked about a rate",
            "Myra asked about a rate",
            ["For Delphine O'Rourke."],
            "http://localhost:5190/admin/users",
            "Open the team",
            "rate_request",
        ))
        self.assertTrue(send_notification_email(
            "jane@example.com",
            "Peter logged no time on Nov 1, 2026",
            "Peter logged no time on Nov 1, 2026",
            ["Peter logged no time on Nov 1, 2026."],
            "http://localhost:5190/admin/analytics",
            "Open team activity",
            "inactive_va",
        ))
        self.assertEqual(self.send.call_count, 5)
        for call in self.send.call_args_list:
            html = call.args[0]["html"]
            self.assertNotIn("$", html)
            self.assertNotIn("₱", html)
            self.assertNotIn("75.00", html)

    def test_unknown_event_does_not_email(self):
        self.assertFalse(send_notification_email(
            "va@example.com", "New task", "New task", ["Assigned"], "http://localhost:5190/va/tasks", "Open", "log_submitted",
        ))
        self.send.assert_not_called()

    def test_email_verification_still_sends(self):
        sent, code = send_email_verification("jane@example.com", "482913", "Jane")
        self.assertTrue(sent)
        self.assertIsNone(code)
        self.send.assert_called_once()
        self.assertIn("482913", self.send.call_args.args[0]["html"])


if __name__ == "__main__":
    unittest.main()
