"""Approved status, link labels, staff notes, and a zero duration."""
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from app.models import TaskStatus, UserRole
from app.services.task_board import (
    STATUS_ORDER,
    can_edit_staff_notes,
    clean_link_label,
    display_link_label,
    format_team_timestamp,
    status_notice,
)
from app.services.work_log_entry import resolve_timing
from fastapi import HTTPException


class StatusTests(unittest.TestCase):
    def test_approved_sits_between_review_and_done(self):
        values = [item.value for item in TaskStatus]
        self.assertEqual(values, list(STATUS_ORDER))
        self.assertLess(values.index("in_review"), values.index("approved"))
        self.assertLess(values.index("approved"), values.index("done"))
        self.assertIn("blocked", values)

    def test_moving_to_approved_notifies_and_done_after_that_does_not(self):
        self.assertEqual(status_notice("in_review", "approved"), "approved")
        self.assertEqual(status_notice("in_review", "done"), "approved")
        self.assertIsNone(status_notice("approved", "done"))
        self.assertEqual(status_notice("in_review", "in_progress"), "rejected")
        self.assertIsNone(status_notice("todo", "in_progress"))


class LinkLabelTests(unittest.TestCase):
    def test_existing_links_keep_the_default_label(self):
        self.assertEqual(display_link_label("google_drive", "Google Drive file"), "Google Drive link")
        self.assertEqual(display_link_label("dropbox", "Dropbox file"), "Dropbox link")
        self.assertEqual(display_link_label("google_drive", ""), "Google Drive link")

    def test_custom_label_is_kept_and_a_blank_label_reverts(self):
        self.assertEqual(display_link_label("google_drive", "Client briefs"), "Client briefs")
        self.assertEqual(clean_link_label("  Shot list  ", "google_drive"), "Shot list")
        self.assertEqual(clean_link_label("   ", "dropbox"), "Dropbox link")

    def test_label_cannot_be_too_long(self):
        with self.assertRaises(ValueError):
            clean_link_label("x" * 81, "google_drive")


class NotesTests(unittest.TestCase):
    def test_only_admin_and_project_manager_can_edit(self):
        self.assertTrue(can_edit_staff_notes(UserRole.admin))
        self.assertTrue(can_edit_staff_notes(UserRole.auditor))
        self.assertFalse(can_edit_staff_notes(UserRole.va))

    def test_timestamp_uses_the_team_time_zone(self):
        when = datetime(2026, 11, 4, 2, 0, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(format_team_timestamp(when, "Asia/Manila"), "November 4, 2026 at 10:00 AM")


class DurationDefaultTests(unittest.TestCase):
    def test_zero_hours_and_minutes_are_rejected_with_the_work_message(self):
        with self.assertRaises(HTTPException) as caught:
            resolve_timing(
                entry_mode="duration",
                start_time=None,
                end_time=None,
                duration_hours=0,
                duration_minutes=0,
            )
        self.assertEqual(caught.exception.detail, "Please enter your actual work duration.")


if __name__ == "__main__":
    unittest.main()
