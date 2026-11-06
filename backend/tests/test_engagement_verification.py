"""Engagement counting rules, Arby-only access, and management audit."""
import io
import inspect
import unittest
import uuid
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from PIL import Image

from app.auth import create_access_token, create_token_payload, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import BillingType, Client, Task, TaskStatus, User, UserRole, VA
from app.models.engagement import EngagementActivity, EngagementAudit, EngagementVerification
from app.services.engagement_access import sync_engagement_subject
from app.services.engagement_rules import (
    classify_activities,
    is_arby_name,
    manual_override,
    overall_status,
    parse_extraction_document,
    platform_from_title,
    summarize,
)
from app.services.engagement_service import add_screenshot_bytes
from app.deps import CurrentUser

MANILA = ZoneInfo("Asia/Manila")
WORK = date(2026, 11, 6)
NOW = datetime(2026, 11, 6, 16, 0, tzinfo=MANILA)


def _window(start: time, end: time, end_next_day: bool = False):
    start_at = datetime.combine(WORK, start, tzinfo=MANILA)
    end_day = date(2026, 11, 7) if end_next_day else WORK
    end_at = datetime.combine(end_day, end, tzinfo=MANILA)
    return [(start_at, end_at)]


def _act(**kwargs):
    row = {
        "id": "a1",
        "screenshot_id": "s1",
        "order": 0,
        "uploaded_at": "2026-11-06T12:00:00",
        "activity_type": "dm",
        "username": "@sarah",
        "activity_date": WORK,
        "activity_time": time(21, 35),
        "text": "Sent the reply about the brief",
        "confidence": "high",
        "platform_hint": "instagram",
        "account_hint": "Client A",
        "share_evidence": None,
        "decision": None,
    }
    row.update(kwargs)
    return row


def _count(platform, rows, windows=None, names=None):
    return classify_activities(
        platform,
        rows,
        work_date=WORK,
        client_names=names or ["Client A"],
        windows=windows if windows is not None else _window(time(21, 0), time(23, 0)),
        tz=MANILA,
        now=NOW,
    )


class NameAndPlatformTests(unittest.TestCase):
    def test_only_the_full_name_matches(self):
        self.assertTrue(is_arby_name("Arby Mae Malumay"))
        self.assertTrue(is_arby_name("  arby   mae malumay "))
        self.assertFalse(is_arby_name("Arby"))
        self.assertFalse(is_arby_name("Arby Malumay"))

    def test_platform_comes_from_the_existing_task_title(self):
        self.assertEqual(platform_from_title("Instagram Community Management"), "instagram")
        self.assertEqual(platform_from_title("Facebook Community Management"), "facebook")
        self.assertEqual(platform_from_title("LinkedIn Community Management"), "linkedin")
        self.assertIsNone(platform_from_title("Inbox triage"))


class InstagramCountTests(unittest.TestCase):
    def test_unique_usernames_and_case(self):
        names = ["@sarah", "@jessica", "@emily", "@Sarah", "@lauren"]
        rows = [
            _act(id=f"a{i}", order=i, username=name, activity_time=time(21, 10 + i))
            for i, name in enumerate(names)
        ]
        result = _count("instagram", rows)
        counted = [row for row in result if row["counted"]]
        self.assertEqual(len(counted), 4)
        self.assertEqual(len([row for row in result if row["status"] == "duplicate"]), 1)

    def test_same_username_can_count_as_dm_and_comment(self):
        rows = [
            _act(id="dm", activity_type="dm", username="@sarah"),
            _act(id="comment", activity_type="comment", username="@SARAH", activity_time=time(21, 40)),
        ]
        result = _count("instagram", rows)
        self.assertEqual(len([row for row in result if row["counted"]]), 2)

    def test_duplicate_across_screenshots_is_not_counted_twice(self):
        rows = [
            _act(id="1", screenshot_id="s1", username="@sarah", uploaded_at="2026-11-06T12:00:00"),
            _act(id="2", screenshot_id="s2", username="@sarah", uploaded_at="2026-11-06T13:00:00", activity_time=time(21, 50)),
        ]
        result = _count("instagram", rows)
        self.assertEqual([row["status"] for row in result], ["verified", "duplicate"])
        self.assertEqual(sum(1 for row in result if row["counted"]), 1)

    def test_partial_username_is_not_invented(self):
        result = _count("instagram", [_act(username=None, confidence="low")])
        self.assertFalse(result[0]["counted"])
        self.assertEqual(result[0]["status"], "needs_review")

    def test_fixture_text_parses_without_filling_gaps(self):
        parsed = parse_extraction_document(
            "PLATFORM: instagram\nACCOUNT: Client A\n---\ntype: dm\nusername: @sarah\ntime: 21:35\ndate: 2026-11-06\nconfidence: high\n---\ntype: comment\nusername:\ntime: 21:40\nconfidence: low\n"
        )
        self.assertEqual(parsed["activities"][0]["username"], "@sarah")
        self.assertIsNone(parsed["activities"][1]["activity_date"])
        self.assertFalse(parsed["activities"][1]["username"])


class FacebookCountTests(unittest.TestCase):
    def _share(self, **kwargs):
        body = {
            "activity_type": "share",
            "username": None,
            "platform_hint": "facebook",
            "share_evidence": True,
            "text": "Shared the spring campaign to the community group",
        }
        body.update(kwargs)
        return _act(**body)

    def test_overlap_is_removed_and_distinct_shares_remain(self):
        rows = []
        for shot in (1, 2, 3):
            for index in range(10):
                text = f"Shared update number {index:02d} with the full caption visible"
                if shot > 1 and index < 5 and shot == 2:
                    text = f"Shared update number {index:02d} with the full caption visible"
                elif shot == 3 and index < 0:
                    text = "unused"
                rows.append(self._share(
                    id=f"{shot}-{index}",
                    screenshot_id=f"s{shot}",
                    order=index,
                    uploaded_at=f"2026-11-06T1{shot}:00:00",
                    activity_time=time(21, index),
                    text=text if not (shot == 3 and index < 5) else f"Shared update number {index:02d} with the full caption visible",
                ))
        # Screenshots 2 and 3 repeat the first five of screenshot 1. 30 visible, 10 duplicate rows, 20 unique.
        # Rebuild a clearer case: 25 unique plus 5 repeated.
        rows = []
        for index in range(25):
            rows.append(self._share(
                id=f"u{index}",
                screenshot_id="s1" if index < 15 else "s2",
                order=index,
                uploaded_at="2026-11-06T12:00:00" if index < 15 else "2026-11-06T13:00:00",
                activity_time=time(21, index % 60),
                activity_date=WORK,
                text=f"Distinct share caption number {index:02d} for the client",
            ))
        for index in range(5):
            rows.append(self._share(
                id=f"d{index}",
                screenshot_id="s3",
                order=index,
                uploaded_at="2026-11-06T14:00:00",
                activity_time=time(21, index),
                text=f"Distinct share caption number {index:02d} for the client",
            ))
        result = _count("facebook", rows)
        self.assertEqual(sum(1 for row in result if row["counted"]), 25)
        self.assertEqual(sum(1 for row in result if row["status"] == "duplicate"), 5)

    def test_same_timestamp_with_different_text_both_count(self):
        rows = [
            self._share(id="1", activity_time=time(21, 10), text="Shared the candle photo with the weekend caption"),
            self._share(id="2", screenshot_id="s2", order=1, activity_time=time(21, 10), text="Shared the hiring post with the studio caption"),
        ]
        result = _count("facebook", rows)
        self.assertEqual(sum(1 for row in result if row["counted"]), 2)

    def test_unsure_overlap_is_flagged_not_dropped_silently(self):
        rows = [
            self._share(id="1", activity_time=time(21, 10), text="Shared a post"),
            self._share(id="2", screenshot_id="s2", order=1, uploaded_at="2026-11-06T13:00:00", activity_time=time(21, 10), text="Shared"),
        ]
        result = _count("facebook", rows)
        self.assertTrue(result[0]["counted"])
        self.assertEqual(result[1]["status"], "needs_review")
        self.assertFalse(result[1]["counted"])

    def test_a_like_is_not_counted_as_a_share(self):
        result = _count("facebook", [self._share(activity_type="like", share_evidence=False)])
        self.assertFalse(result[0]["counted"])
        self.assertIn(result[0]["status"], {"needs_review", "invalid"})


class LinkedInCountTests(unittest.TestCase):
    def test_comments_only_and_connects_do_not_count(self):
        rows = [
            _act(id="c1", activity_type="comment", platform_hint="linkedin", username="Jane Doe"),
            _act(id="c2", activity_type="comment", platform_hint="linkedin", username="jane doe", activity_time=time(21, 45), screenshot_id="s2", uploaded_at="2026-11-06T13:00:00"),
            _act(id="k", activity_type="connect", platform_hint="linkedin", username="Sam Lee", activity_time=time(21, 50)),
        ]
        result = _count("linkedin", rows)
        comments = [row for row in result if row["activity_type"] == "comment"]
        self.assertEqual(sum(1 for row in comments if row["counted"]), 1)
        connect = next(row for row in result if row["activity_type"] == "connect")
        self.assertEqual(connect["status"], "excluded")
        self.assertFalse(connect["counted"])


class TimingTests(unittest.TestCase):
    def test_date_mismatch_is_not_counted(self):
        result = _count("instagram", [_act(activity_date=date(2026, 11, 5))])
        self.assertEqual(result[0]["status"], "invalid")
        self.assertFalse(result[0]["counted"])
        self.assertTrue(any(alert["code"] == "DATE_MISMATCH" for alert in result[0]["alerts"]))

    def test_time_outside_clock_is_flagged(self):
        inside = _count("instagram", [_act(activity_time=time(22, 35))])
        outside = _count("instagram", [_act(id="late", activity_time=time(23, 45))])
        self.assertTrue(inside[0]["counted"])
        self.assertEqual(outside[0]["status"], "invalid")
        self.assertTrue(any(alert["code"] == "TIME_MISMATCH" for alert in outside[0]["alerts"]))

    def test_overnight_shift_accepts_the_next_morning_inside_the_clock(self):
        windows = _window(time(21, 0), time(2, 0), end_next_day=True)
        kept = _count("instagram", [_act(activity_date=date(2026, 11, 7), activity_time=time(1, 30))], windows)
        dropped = _count("instagram", [_act(id="late", activity_date=date(2026, 11, 7), activity_time=time(3, 0))], windows)
        self.assertTrue(kept[0]["counted"])
        self.assertFalse(dropped[0]["counted"])
        self.assertTrue(any(alert["code"] == "DATE_MISMATCH" for alert in dropped[0]["alerts"]))


class StatusTests(unittest.TestCase):
    def _cats(self, verified, minimum=20, maximum=25):
        return [{"verified": verified, "min": minimum, "max": maximum}]

    def test_statuses(self):
        self.assertEqual(overall_status(screenshot_count=0, categories=self._cats(0), pending_review=0, workday_ended=False, approved=False), "not_started")
        self.assertEqual(overall_status(screenshot_count=1, categories=self._cats(4), pending_review=0, workday_ended=False, approved=False), "in_progress")
        self.assertEqual(overall_status(screenshot_count=1, categories=self._cats(4), pending_review=1, workday_ended=False, approved=False), "needs_review")
        self.assertEqual(overall_status(screenshot_count=1, categories=self._cats(20), pending_review=0, workday_ended=False, approved=False), "target_met")
        self.assertEqual(overall_status(screenshot_count=1, categories=self._cats(26), pending_review=0, workday_ended=False, approved=False), "target_exceeded")
        self.assertEqual(overall_status(screenshot_count=1, categories=self._cats(4), pending_review=0, workday_ended=True, approved=False), "incomplete")
        self.assertEqual(overall_status(screenshot_count=1, categories=self._cats(22), pending_review=0, workday_ended=True, approved=True), "completed")
        self.assertNotEqual(overall_status(screenshot_count=1, categories=self._cats(22), pending_review=0, workday_ended=True, approved=False), "completed")

    def test_counts_above_the_maximum_stay_and_mark_target_exceeded(self):
        rows = []
        for index in range(26):
            rows.append(_act(id=f"dm{index}", order=index, username=f"@dm{index}", activity_time=time(21, index % 50)))
        for index in range(16):
            rows.append(_act(
                id=f"c{index}",
                order=index,
                activity_type="comment",
                username=f"@comment{index}",
                activity_time=time(22, index % 50),
                screenshot_id="s2",
            ))
        classified = _count("instagram", rows)
        verified_dms = [row for row in classified if row["activity_type"] == "dm" and row["counted"]]
        verified_comments = [row for row in classified if row["activity_type"] == "comment" and row["counted"]]
        self.assertEqual(len(verified_dms), 26)
        self.assertEqual(len(verified_comments), 16)
        summary = summarize(
            "instagram",
            classified,
            screenshot_count=1,
            unclear_screenshots=[],
            targets=[
                {"key": "dm", "label": "Direct Messages", "min": 20, "max": 25},
                {"key": "comment", "label": "Comments", "min": 10, "max": 15},
            ],
            workday_ended=False,
            approved=False,
            submitted=False,
        )
        self.assertEqual(summary["status"], "target_exceeded")
        self.assertEqual(summary["categories"][0]["verified"], 26)
        self.assertEqual(summary["categories"][1]["verified"], 16)
        self.assertEqual(summary["categories"][0]["completion_pct"], 100)
        self.assertEqual(summary["completion_pct"], 100)

    def test_linkedin_comments_can_pass_twenty(self):
        rows = [
            _act(id=f"c{index}", order=index, activity_type="comment", platform_hint="linkedin", username=f"Person {index}", activity_time=time(21, index % 50))
            for index in range(21)
        ]
        rows.append(_act(id="connect", activity_type="connect", platform_hint="linkedin", username="Someone Else", activity_time=time(21, 10)))
        classified = _count("linkedin", rows)
        comments = [row for row in classified if row["activity_type"] == "comment" and row["counted"]]
        connects = [row for row in classified if row["activity_type"] == "connect"]
        self.assertEqual(len(comments), 21)
        self.assertEqual(connects[0]["status"], "excluded")
        summary = summarize(
            "linkedin",
            classified,
            screenshot_count=1,
            unclear_screenshots=[],
            targets=[{"key": "comment", "label": "Comments", "min": 20, "max": 20}],
            workday_ended=False,
            approved=False,
            submitted=False,
        )
        self.assertEqual(summary["status"], "target_exceeded")
        self.assertEqual(summary["categories"][0]["verified"], 21)

    def test_summarize_does_not_accept_a_typed_total(self):
        self.assertNotIn("verified_total", inspect.signature(summarize).parameters)
        self.assertNotIn("claimed", inspect.signature(summarize).parameters)

    def test_override_keeps_the_original_result_and_requires_a_reason(self):
        original = {"status": "needs_review", "counted": False, "alerts": [{"code": "DATE_MISMATCH"}], "explanation": "Date mismatch"}
        with self.assertRaises(ValueError):
            manual_override(original=original, decision="approved", reason="  ", actor_name="Leya", when=NOW)
        entry = manual_override(original=original, decision="approved", reason="Client confirmed the date", actor_name="Leya", when=NOW)
        self.assertEqual(entry["original_result"]["status"], "needs_review")
        self.assertEqual(entry["original_result"]["counted"], False)
        self.assertEqual(entry["actor_name"], "Leya")
        self.assertIn("Client confirmed", entry["reason"])


def _png() -> bytes:
    image = Image.new("RGB", (20, 20), (180, 50, 90))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _auth(user, va=None):
    token = create_access_token(create_token_payload(user.id, user.role.value, va.id if va else None))
    return {"Authorization": f"Bearer {token}"}


class AccessAndAuditTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.created_user_ids = []
        self.client_row = Client(name=f"Engagement Co {uuid.uuid4().hex[:6]}", billing_type=BillingType.hourly, is_active=True)
        self.db.add(self.client_row)
        self.db.flush()
        self.arby_user, self.arby = self._person("Arby Mae Malumay", UserRole.va, flag=True)
        self.other_user, self.other = self._person("Other VA", UserRole.va, flag=False)
        self.pm_user, _pm = self._person("Leya PM", UserRole.auditor, flag=False)
        self.task = Task(
            title="Instagram Community Management",
            client_id=self.client_row.id,
            assignee_va_id=self.arby.id,
            status=TaskStatus.todo,
            due_date=date.today(),
        )
        self.db.add(self.task)
        self.db.commit()

    def _person(self, name, role, flag):
        email = f"{uuid.uuid4().hex[:8]}@example.com"
        user = User(email=email, password_hash=hash_password("test1234"), role=role, display_name=name, is_active=True)
        self.db.add(user)
        self.db.flush()
        self.created_user_ids.append(user.id)
        va = None
        if role == UserRole.va:
            va = VA(user_id=user.id, name=name, currency="PHP", is_active=True, engagement_verification=flag)
            self.db.add(va)
            self.db.flush()
        return user, va

    def tearDown(self):
        self.db.rollback()
        if self.task.id:
            self.db.query(EngagementAudit).filter(EngagementAudit.client_id == self.client_row.id).delete(synchronize_session=False)
            ver_ids = [row.id for row in self.db.query(EngagementVerification).filter(EngagementVerification.task_id == self.task.id).all()]
            if ver_ids:
                self.db.query(EngagementActivity).filter(EngagementActivity.verification_id.in_(ver_ids)).delete(synchronize_session=False)
                from app.models.engagement import EngagementScreenshot
                self.db.query(EngagementScreenshot).filter(EngagementScreenshot.verification_id.in_(ver_ids)).delete(synchronize_session=False)
                self.db.query(EngagementAudit).filter(EngagementAudit.verification_id.in_(ver_ids)).delete(synchronize_session=False)
                self.db.query(EngagementVerification).filter(EngagementVerification.id.in_(ver_ids)).delete(synchronize_session=False)
            self.db.query(Task).filter(Task.id == self.task.id).delete(synchronize_session=False)
        self.db.query(Task).filter(Task.client_id == self.client_row.id).delete(synchronize_session=False)
        self.db.query(VA).filter(VA.user_id.in_(self.created_user_ids)).delete(synchronize_session=False)
        self.db.query(User).filter(User.id.in_(self.created_user_ids)).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id == self.client_row.id).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_other_va_cannot_open_the_feature(self):
        denied = self.client.get("/engagement/tasks", headers=_auth(self.other_user, self.other))
        self.assertEqual(denied.status_code, 403)
        allowed = self.client.get("/engagement/tasks", headers=_auth(self.arby_user, self.arby))
        self.assertEqual(allowed.status_code, 200)
        self.assertNotIn("rate", allowed.json())
        sync_engagement_subject(self.db)
        self.db.refresh(self.other)
        self.assertFalse(self.other.engagement_verification)

    def test_upload_counts_fixture_text_and_override_is_audited(self):
        def fake_extract(_raw):
            return parse_extraction_document(
                "PLATFORM: instagram\nACCOUNT: Engagement Co\n---\n"
                "type: dm\nusername: @sarah\ntime: 09:00\ndate: %s\nconfidence: high\n"
                % date.today().isoformat()
            ) | {"readable": True, "account": self.client_row.name}

        # The fake date must match the task work date. Clock may be missing, so this flags time.
        current = CurrentUser(user=self.arby_user, va_id=self.arby.id)
        add_screenshot_bytes(
            self.db,
            task=self.task,
            owner=self.arby,
            current=current,
            filename="shot.png",
            content_type="image/png",
            raw=_png(),
            extract=fake_extract,
        )
        stored = self.db.query(Task).filter(Task.id == self.task.id).one()
        self.assertEqual(stored.status, TaskStatus.todo)
        activity = self.db.query(EngagementActivity).filter(EngagementActivity.verification_id.isnot(None)).filter(EngagementActivity.username_raw == "@sarah").one()
        self.assertFalse(activity.counted)
        self.assertIsNotNone(activity.original_result)
        approved = self.client.post(
            f"/engagement/activities/{activity.id}/approve",
            headers=_auth(self.pm_user),
            json={"reason": "Clock record was corrected for this client."},
        )
        self.assertEqual(approved.status_code, 200)
        self.db.refresh(activity)
        audit = self.db.query(EngagementAudit).filter(EngagementAudit.activity_id == activity.id).one()
        self.assertEqual(audit.actor_name, "Leya PM")
        self.assertEqual(audit.original_result["counted"], False)
        self.assertTrue(audit.reason)
        body = approved.json()
        self.assertNotIn("va_rate", body)
        self.assertNotIn("amount", body)
        denied = self.client.post(
            f"/engagement/activities/{activity.id}/reject",
            headers=_auth(self.arby_user, self.arby),
            json={"reason": "I want to change the total"},
        )
        self.assertEqual(denied.status_code, 403)

    def test_community_engagement_va_is_included_and_a_content_va_is_not(self):
        gem_user, gem = self._person("Gem Santos", UserRole.va, flag=False)
        content_user, content = self._person("Myra Content", UserRole.va, flag=False)
        self.db.add(Task(
            title="LinkedIn Community Management",
            client_id=self.client_row.id,
            assignee_va_id=gem.id,
            status=TaskStatus.todo,
            due_date=date.today(),
        ))
        self.db.add(Task(
            title="Inbox triage",
            client_id=self.client_row.id,
            assignee_va_id=content.id,
            status=TaskStatus.todo,
            due_date=date.today(),
        ))
        self.db.commit()
        allowed = self.client.get("/engagement/tasks", headers=_auth(gem_user, gem))
        self.assertEqual(allowed.status_code, 200)
        self.db.refresh(gem)
        self.assertTrue(gem.engagement_verification)
        denied = self.client.get("/engagement/tasks", headers=_auth(content_user, content))
        self.assertEqual(denied.status_code, 403)
        self.db.refresh(content)
        self.assertFalse(content.engagement_verification)
        admin = self.db.query(User).filter(User.role == UserRole.admin).first()
        self.assertIsNotNone(admin)
        roster = self.client.get("/engagement/vas", headers=_auth(admin))
        self.assertEqual(roster.status_code, 200)
        self.assertNotIn("rate", roster.text.lower())
        turned_off = self.client.patch(f"/engagement/vas/{gem.id}", headers=_auth(admin), json={"enabled": False})
        self.assertEqual(turned_off.status_code, 200)
        self.db.refresh(gem)
        self.assertFalse(gem.engagement_verification)
        self.assertTrue(gem.engagement_verification_manual)
        sync_engagement_subject(self.db)
        self.db.refresh(gem)
        self.assertFalse(gem.engagement_verification)
        pm_toggle = self.client.patch(f"/engagement/vas/{gem.id}", headers=_auth(self.pm_user), json={"enabled": True})
        self.assertEqual(pm_toggle.status_code, 403)

    def test_name_sync_follows_engagement_tasks_not_only_a_name(self):
        self.arby.engagement_verification = False
        self.arby.engagement_verification_manual = False
        self.db.commit()
        sync_engagement_subject(self.db)
        self.db.refresh(self.arby)
        self.assertTrue(self.arby.engagement_verification)
        self.other.engagement_verification_manual = True
        self.other.engagement_verification = False
        self.db.add(Task(
            title="Facebook Community Management",
            client_id=self.client_row.id,
            assignee_va_id=self.other.id,
            status=TaskStatus.todo,
            due_date=date.today(),
        ))
        self.db.commit()
        sync_engagement_subject(self.db)
        self.db.refresh(self.other)
        self.assertFalse(self.other.engagement_verification)


if __name__ == "__main__":
    unittest.main()
