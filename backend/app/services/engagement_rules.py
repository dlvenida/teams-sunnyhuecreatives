"""Counting rules for engagement screenshot verification.

Pure functions. Nothing here reads a live vision service, and nothing here
accepts a number typed by the VA as a verified total.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ARBY_CANONICAL_NAME = "arby mae malumay"

PLATFORMS = ("instagram", "facebook", "linkedin")

DEFAULT_TARGETS = {
    "instagram": {
        "dm": {"label": "Direct Messages", "min": 20, "max": 25},
        "comment": {"label": "Comments", "min": 10, "max": 15},
    },
    "facebook": {
        "share": {"label": "Group shares", "min": 25, "max": 30},
    },
    "linkedin": {
        "comment": {"label": "Comments", "min": 20, "max": 20},
    },
}

STATUS_LABELS = {
    "not_started": "Not started",
    "in_progress": "In progress",
    "needs_review": "Needs review",
    "target_met": "Target met",
    "completed": "Completed",
    "target_exceeded": "Target exceeded",
    "incomplete": "Incomplete",
}

# Shown when a file was uploaded but the reader did not return activities.
# A zero in that case is not a counted shortfall.
UNREAD_SCREENSHOT_NOTE = "This screenshot could not be read. Nothing on it was counted."

ALERT_LABELS = {
    "DATE_MISMATCH": "Date mismatch",
    "TIME_MISMATCH": "Time mismatch",
    "DUPLICATE_ACTIVITY": "Duplicate activity",
    "MISSING_EVIDENCE": "Missing evidence",
    "BELOW_TARGET": "Below target",
    "UNCLEAR_SCREENSHOT": "Unclear screenshot",
    "ACCOUNT_MISMATCH": "Account mismatch",
}


def canonical_person_name(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def is_arby_name(*values: str | None) -> bool:
    """Exact name match used once to turn the feature on. Not used on every request."""
    return any(canonical_person_name(value) == ARBY_CANONICAL_NAME for value in values)


def platform_from_title(title: str | None) -> str | None:
    text = (title or "").casefold()
    if "linkedin" in text:
        return "linkedin"
    if "instagram" in text:
        return "instagram"
    if "facebook" in text:
        return "facebook"
    return None


def normalize_profile(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip().lstrip("@")
    text = re.sub(r"\s+", " ", text).casefold()
    return text or None


def normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").casefold()).strip()


def _norm_name(value: str | None) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", (value or "").casefold())
    return " ".join(text.split())


def account_state(hint: str | None, names: list[str]) -> str:
    """match, mismatch, or unknown. Unknown is not treated as a match."""
    if not (hint or "").strip():
        return "unknown"
    left = _norm_name(hint)
    if not left:
        return "unknown"
    known = [_norm_name(name) for name in names if _norm_name(name)]
    if not known:
        return "unknown"
    for name in known:
        if name in left or left in name:
            return "match"
    return "mismatch"


def canonical_type(value: str | None) -> str:
    text = re.sub(r"[\s\-]+", "_", (value or "").strip().casefold())
    aliases = {
        "dm": "dm",
        "dms": "dm",
        "direct": "dm",
        "direct_message": "dm",
        "direct_messages": "dm",
        "message": "dm",
        "messages": "dm",
        "comment": "comment",
        "comments": "comment",
        "share": "share",
        "shares": "share",
        "group_share": "share",
        "group_shares": "share",
        "shared": "share",
        "connect": "connect",
        "connection": "connect",
        "connection_request": "connect",
        "connections": "connect",
        "draft": "draft",
        "unsent": "unsent",
    }
    return aliases.get(text, text or "unknown")


def _parse_date(value: str | None) -> date | None:
    raw = (value or "").strip()
    if not raw or raw.casefold() in {"null", "none", "unknown"}:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _parse_time(value: str | None) -> time | None:
    raw = (value or "").strip()
    if not raw or raw.casefold() in {"null", "none", "unknown"}:
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?", raw)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    second = int(match.group(3) or 0)
    meridiem = (match.group(4) or "").casefold()
    if meridiem == "pm" and hour < 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute, second)


def _confidence(value: str | None) -> str:
    return "high" if (value or "").strip().casefold() == "high" else "low"


def _share_flag(value) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().casefold()
    if text in {"yes", "true", "1", "high"}:
        return True
    if text in {"no", "false", "0"}:
        return False
    return None


def parse_extraction_document(text: str) -> dict:
    """Read the fixture format. Missing dates, names, and counts stay empty."""
    header: dict[str, str] = {}
    blocks: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped == "---":
            if current:
                blocks.append(current)
            current = {}
            continue
        if ":" not in stripped:
            continue
        key, _, raw = stripped.partition(":")
        key = key.strip().casefold().replace(" ", "_")
        if current is None:
            header[key] = raw.strip()
        else:
            current[key] = raw.strip()
    if current:
        blocks.append(current)

    activities = []
    for index, block in enumerate(blocks):
        if "type" not in block and "username" not in block and "text" not in block:
            continue
        activities.append({
            "order": index,
            "activity_type": canonical_type(block.get("type")),
            "username": block.get("username") or None,
            "activity_date": _parse_date(block.get("date")),
            "activity_time": _parse_time(block.get("time")),
            "text": block.get("text") or None,
            "confidence": _confidence(block.get("confidence")),
            "platform_hint": (block.get("platform") or header.get("platform") or None),
            "account_hint": block.get("account") or header.get("account") or None,
            "share_evidence": _share_flag(block.get("share_evidence")),
        })
    platform = (header.get("platform") or "").casefold() or None
    return {
        "platform": platform if platform in PLATFORMS or platform == "unknown" else platform,
        "account": header.get("account") or None,
        "readable": bool(activities) or header.get("readable", "").casefold() == "yes",
        "activities": activities,
        "note": header.get("note") or None,
    }


def parse_extraction_payload(data: dict | None) -> dict:
    """Normalize a structured reader result. Nulls stay null."""
    data = data or {}
    activities = []
    for index, item in enumerate(data.get("activities") or []):
        if not isinstance(item, dict):
            continue
        activities.append({
            "order": index,
            "activity_type": canonical_type(item.get("type") or item.get("activity_type")),
            "username": item.get("username") or None,
            "activity_date": item.get("activity_date") if isinstance(item.get("activity_date"), date) else _parse_date(item.get("date") if isinstance(item.get("date"), str) else None),
            "activity_time": item.get("activity_time") if isinstance(item.get("activity_time"), time) else _parse_time(item.get("time") if isinstance(item.get("time"), str) else None),
            "text": item.get("text") or None,
            "confidence": _confidence(item.get("confidence")),
            "platform_hint": item.get("platform") or data.get("platform"),
            "account_hint": item.get("account") or data.get("account"),
            "share_evidence": _share_flag(item.get("share_evidence")),
        })
    platform = (data.get("platform") or "").casefold() or None
    readable = bool(data.get("readable")) and bool(activities)
    if data.get("readable") is True and activities:
        readable = True
    elif not activities:
        readable = False
    return {
        "platform": platform,
        "account": data.get("account") or None,
        "readable": readable,
        "activities": activities,
        "note": data.get("note") or None,
    }


def _as_utc(value: datetime, fallback_tz: ZoneInfo) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=fallback_tz)
    return value.astimezone(timezone.utc)


def assess_timing(
    *,
    activity_date: date | None,
    activity_time: time | None,
    work_date: date,
    windows: list[tuple[datetime, datetime | None]],
    tz: ZoneInfo,
    now: datetime,
) -> str:
    """ok, overnight_ok, missing, no_clock, date_mismatch, or time_mismatch."""
    if activity_date is None or activity_time is None:
        return "missing"
    session = []
    for start, end in windows:
        start_utc = _as_utc(start, tz)
        if start_utc.astimezone(tz).date() == work_date:
            session.append((start_utc, _as_utc(end, tz) if end else None))
    if not session:
        return "no_clock"
    local = datetime.combine(activity_date, activity_time, tzinfo=tz)
    moment = local.astimezone(timezone.utc)
    now_utc = _as_utc(now, tz)
    inside = False
    for start, end in session:
        end_eff = end or now_utc
        if start <= moment <= end_eff:
            inside = True
            break
    if activity_date == work_date and inside:
        return "ok"
    if activity_date == work_date + timedelta(days=1) and inside:
        return "overnight_ok"
    if activity_date != work_date:
        return "date_mismatch"
    return "time_mismatch"


def _tokens(text: str) -> set[str]:
    return {part for part in re.split(r"[^a-z0-9@]+", text) if part}


def facebook_relation(left: dict, right: dict) -> str:
    """same, unsure, or different. Same timestamp alone is not a duplicate."""
    if left.get("activity_date") != right.get("activity_date"):
        return "different"
    if left.get("activity_time") != right.get("activity_time"):
        return "different"
    a = normalize_text(left.get("text"))
    b = normalize_text(right.get("text"))
    if a and b and a == b and len(a) >= 8:
        return "same"
    if not a or not b or len(a) < 8 or len(b) < 8:
        return "unsure" if left.get("activity_time") else "different"
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return "unsure"
    overlap = len(ta & tb) / len(ta | tb)
    if overlap >= 0.85:
        return "same"
    if overlap >= 0.45:
        return "unsure"
    return "different"


def _alert(code: str, explanation: str) -> dict:
    return {"code": code, "label": ALERT_LABELS[code], "explanation": explanation}


def classify_activities(
    platform: str,
    activities: list[dict],
    *,
    work_date: date,
    client_names: list[str],
    windows: list[tuple[datetime, datetime | None]],
    tz: ZoneInfo,
    now: datetime,
) -> list[dict]:
    """Return a new list. Decisions already stored on an activity are honored."""
    ordered = sorted(
        activities,
        key=lambda item: (str(item.get("uploaded_at") or ""), int(item.get("order") or 0), str(item.get("id") or "")),
    )
    counted_keys: set[tuple] = set()
    counted_facebook: list[dict] = []
    results: list[dict] = []
    expected = {"instagram": {"dm", "comment"}, "facebook": {"share"}, "linkedin": {"comment"}}[platform]

    for raw in ordered:
        item = dict(raw)
        atype = canonical_type(item.get("activity_type"))
        item["activity_type"] = atype
        decision = item.get("decision")
        alerts: list[dict] = []
        explanation = None

        if decision == "rejected":
            item.update({
                "status": "rejected",
                "counted": False,
                "alerts": [_alert("UNCLEAR_SCREENSHOT", item.get("decision_reason") or "Management rejected this activity.")],
                "username_key": normalize_profile(item.get("username")),
            })
            item["explanation"] = rejection_reason(item)
            results.append(item)
            continue

        if platform == "linkedin" and atype == "connect":
            item.update({
                "status": "excluded",
                "counted": False,
                "alerts": [],
                "explanation": "Connection requests are not counted toward the LinkedIn comment target.",
                "username_key": normalize_profile(item.get("username")),
            })
            results.append(item)
            continue

        if atype in {"draft", "unsent"}:
            item.update({
                "status": "invalid",
                "counted": False,
                "alerts": [],
                "explanation": "Drafts and unsent messages are not counted.",
                "username_key": normalize_profile(item.get("username")),
            })
            results.append(item)
            continue

        hint = (item.get("platform_hint") or "").casefold() or None
        if hint and hint not in {"unknown", platform}:
            alerts.append(_alert("UNCLEAR_SCREENSHOT", f"This screenshot looks like {hint}, but this task is {platform}."))

        account = account_state(item.get("account_hint"), client_names)
        if account == "unknown":
            alerts.append(_alert("UNCLEAR_SCREENSHOT", "The client account could not be confirmed on this screenshot."))
        elif account == "mismatch":
            alerts.append(_alert("ACCOUNT_MISMATCH", f"This screenshot shows {item.get('account_hint')}, which does not match this client."))

        timing = assess_timing(
            activity_date=item.get("activity_date"),
            activity_time=item.get("activity_time"),
            work_date=work_date,
            windows=windows,
            tz=tz,
            now=now,
        )
        if timing == "missing":
            alerts.append(_alert("UNCLEAR_SCREENSHOT", "The activity date or time could not be read. It was not counted."))
        elif timing == "no_clock":
            alerts.append(_alert("TIME_MISMATCH", "No clock-in was recorded for this work date, so the activity time could not be checked."))
        elif timing == "date_mismatch":
            alerts.append(_alert("DATE_MISMATCH", f"The activity date does not match the work date {work_date.isoformat()}."))
        elif timing == "time_mismatch":
            alerts.append(_alert("TIME_MISMATCH", "This activity falls outside the recorded clock-in and clock-out."))

        username_key = normalize_profile(item.get("username"))
        item["username_key"] = username_key
        if atype not in expected:
            if platform == "facebook":
                alerts.append(_alert("UNCLEAR_SCREENSHOT", "This entry does not show enough evidence of a group share."))
            else:
                alerts.append(_alert("UNCLEAR_SCREENSHOT", "The activity type could not be confirmed for this task."))
        if platform in {"instagram", "linkedin"} and atype in expected and not username_key:
            alerts.append(_alert("UNCLEAR_SCREENSHOT", "The username could not be read, so this activity was not counted."))
        if item.get("confidence") != "high":
            alerts.append(_alert("UNCLEAR_SCREENSHOT", "This activity was only partly visible, so it was not counted."))
        if platform == "facebook" and atype == "share" and item.get("share_evidence") is False:
            alerts.append(_alert("UNCLEAR_SCREENSHOT", "This entry does not show enough evidence of a group share."))

        dedup_key = None
        if platform in {"instagram", "linkedin"} and username_key and atype in expected:
            dedup_key = (atype, username_key)

        fb_relation = None
        if platform == "facebook" and atype == "share":
            for previous in counted_facebook:
                relation = facebook_relation(item, previous)
                if relation == "same":
                    fb_relation = "same"
                    break
                if relation == "unsure" and fb_relation != "same":
                    fb_relation = "unsure"

        force = decision == "approved"
        blocking = [alert for alert in alerts]
        if force:
            # A documented management exception can count a date, time, account, or unclear item.
            # It cannot count a second copy of an activity that was already counted.
            blocking = []

        if fb_relation == "same" or (dedup_key and dedup_key in counted_keys):
            alerts.append(_alert("DUPLICATE_ACTIVITY", "This activity was already counted for this client and workday."))
            item.update({
                "status": "duplicate",
                "counted": False,
                "alerts": alerts,
                "explanation": "This activity was already counted for this client and workday.",
            })
            results.append(item)
            continue

        if fb_relation == "unsure" and not force:
            alerts.append(_alert(
                "DUPLICATE_ACTIVITY",
                "This may be the same share as another entry with the same time. It was not counted. Management can review it.",
            ))
            item.update({
                "status": "needs_review",
                "counted": False,
                "alerts": alerts,
                "explanation": "This may repeat another share. It was flagged instead of counted.",
            })
            results.append(item)
            continue

        if blocking and not force:
            codes = {alert["code"] for alert in blocking}
            # A wrong date, time, or account is invalid. Anything we cannot read stays in review.
            if codes & {"DATE_MISMATCH", "TIME_MISMATCH", "ACCOUNT_MISMATCH"}:
                status = "invalid"
            else:
                status = "needs_review"
            item.update({
                "status": status,
                "counted": False,
                "alerts": alerts,
            })
            item["explanation"] = rejection_reason(item)
            results.append(item)
            continue

        status = "approved" if force else "verified"
        item.update({
            "status": status,
            "counted": True,
            "alerts": alerts if not force else alerts,
            "explanation": item.get("decision_reason") if force else None,
        })
        if dedup_key:
            counted_keys.add(dedup_key)
        if platform == "facebook" and atype == "share":
            counted_facebook.append(item)
        results.append(item)
        _ = explanation
    return results


def category_targets(platform: str, stored: dict | None = None) -> list[dict]:
    stored = stored or {}
    defaults = DEFAULT_TARGETS[platform]
    rows = []
    for key, default in defaults.items():
        if key == "dm":
            minimum = stored.get("dm_min")
            maximum = stored.get("dm_max")
        elif key == "comment":
            minimum = stored.get("comment_min")
            maximum = stored.get("comment_max")
        else:
            minimum = stored.get("share_min")
            maximum = stored.get("share_max")
        rows.append({
            "key": key,
            "label": default["label"],
            "min": int(minimum if minimum is not None else default["min"]),
            "max": int(maximum if maximum is not None else default["max"]),
        })
    return rows


def _completion(verified: int, minimum: int) -> int:
    if minimum <= 0:
        return 100
    return min(100, round(100 * verified / max(minimum, 1)))


def overall_status(
    *,
    screenshot_count: int,
    categories: list[dict],
    pending_review: int,
    workday_ended: bool,
    approved: bool,
    unreadable_screenshots: int = 0,
    reader_failed: bool = False,
) -> str:
    """Below a counted minimum is Needs review. Meeting it is Target met.

    An unread screenshot stays in review until someone opens it. Flagged rows
    that were not counted do not pull a day back once the verified minimum is met.
    Over the maximum is Target exceeded. Approving an unread upload does not invent a count.
    """
    if screenshot_count == 0 and not workday_ended:
        return "not_started"
    mins_met = all(row["verified"] >= row["min"] for row in categories) if categories else False
    any_over = any(row["verified"] > row["max"] for row in categories)
    below = any(row["verified"] < row["min"] for row in categories) if categories else screenshot_count == 0
    if approved and (reader_failed or mins_met):
        return "completed"
    if reader_failed or unreadable_screenshots:
        return "needs_review"
    if below or (pending_review > 0 and not mins_met):
        return "needs_review"
    if mins_met and any_over:
        return "target_exceeded"
    if mins_met:
        return "target_met"
    if workday_ended:
        return "needs_review"
    return "in_progress"


def rejection_reason(item: dict) -> str:
    """A rejected or not-counted item always has a readable reason."""
    for key in ("explanation", "decision_reason", "rejection_note"):
        text = " ".join(str(item.get(key) or "").split())
        if text:
            return text
    for alert in item.get("alerts") or []:
        text = " ".join(str((alert or {}).get("explanation") or "").split())
        if text:
            return text
        code = (alert or {}).get("code")
        if code in ALERT_LABELS:
            return f"{ALERT_LABELS[code]}. This was not counted."
    status = item.get("status")
    if status == "duplicate":
        return "Duplicate activity. This was already counted."
    if status == "invalid":
        return "Not counted. The screenshot check could not confirm this activity."
    return "Rejected. Approve it here if this evidence should count."


_LACKING_WORD = {
    "dm": "DMs",
    "comment": "comments",
    "share": "shares",
}

_METRIC_NAME = {
    ("instagram", "dm"): "Instagram DMs",
    ("instagram", "comment"): "Instagram comments",
    ("facebook", "share"): "Facebook shares",
    ("linkedin", "comment"): "LinkedIn comments",
}


def _lacking_lead(words: list[str]) -> str:
    if len(words) == 1:
        return f"Lacking {words[0]}."
    if len(words) == 2:
        return f"Lacking {words[0]} and {words[1]}."
    return "Lacking " + ", ".join(words[:-1]) + f", and {words[-1]}."


def below_minimum_reason(item: dict) -> str | None:
    """Plain reason when a daily count is short. None when every minimum is met."""
    platform = (item.get("platform") or "").casefold()
    words: list[str] = []
    counts: list[str] = []
    for category in item.get("categories") or []:
        if not isinstance(category, dict):
            continue
        try:
            verified = int(category.get("verified"))
            minimum = int(category.get("min"))
        except (TypeError, ValueError):
            continue
        if verified >= minimum:
            continue
        key = category.get("key")
        word = _LACKING_WORD.get(key)
        metric = _METRIC_NAME.get((platform, key))
        if not word or not metric:
            label = " ".join(str(category.get("label") or "").split())
            if not label:
                continue
            word = label.casefold()
            metric = label
        words.append(word)
        counts.append(f"{metric} {verified} of {minimum}")
    if not words:
        return None
    return f"{_lacking_lead(words)} {'. '.join(counts)}."


def _uploaded_but_not_counted(item: dict) -> bool:
    """Screenshots are on the task, and no activity was verified.

    The zeros on that task are not a measured shortfall. A day with no
    screenshot at all is different: that zero is the empty total.
    """
    if item.get("reader_failed") or item.get("counts_not_measured"):
        return True
    categories = [row for row in item.get("categories") or [] if isinstance(row, dict)]
    verified_values: list[int] = []
    for category in categories:
        try:
            verified_values.append(int(category.get("verified")))
        except (TypeError, ValueError):
            continue
    if any(value > 0 for value in verified_values):
        return False
    try:
        if int(item.get("verified_total") or 0) > 0:
            return False
    except (TypeError, ValueError):
        pass
    shots = [row for row in item.get("screenshots") or [] if isinstance(row, dict)]
    if shots:
        return True
    alerts = [row for row in item.get("alerts") or [] if isinstance(row, dict)]
    if any(row.get("code") == "UNCLEAR_SCREENSHOT" and not row.get("activity_id") for row in alerts):
        return not verified_values or all(value == 0 for value in verified_values)
    return False


def in_review_queue(item: dict) -> bool:
    """Tasks a manager still has to open.

    Target met and target exceeded stay off this list. A duplicate note does
    not pull them back on. Sent back, a rejected activity, and an explicit
    submit still do.
    """
    if item.get("status") in {"needs_review", "incomplete"}:
        return True
    if item.get("approval") in {"Pending management review", "Sent back"}:
        return True
    if item.get("approval") == "Approved":
        return False
    for activity in item.get("activities") or []:
        if isinstance(activity, dict) and (activity.get("status") == "rejected" or activity.get("decision") == "rejected"):
            return True
    if item.get("status") in {"target_met", "target_exceeded", "completed"}:
        return False
    return bool(item.get("rejection_reasons"))


def _as_rejected(text: str) -> str:
    lowered = text.casefold()
    if lowered.startswith("rejected:") or lowered.startswith("sent back"):
        return text
    return f"Rejected: {text}"


def review_reasons(item: dict) -> list[str]:
    """Why this task is on the review list, from the counts and stored notes.

    Below-minimum work leads with lacking DMs, comments, or shares. A stored
    reject note stays labeled as rejected. Nothing is added when the counts
    and status do not support it.
    """
    if not in_review_queue(item):
        return []
    lines: list[str] = []
    seen: set[str] = set()

    def add(text: str | None) -> None:
        cleaned = " ".join(str(text or "").split())
        if not cleaned:
            return
        key = cleaned.casefold()
        if key in seen:
            return
        seen.add(key)
        lines.append(cleaned)

    # Zero verified from an upload that was not counted is not "lacking".
    lacking = None if _uploaded_but_not_counted(item) else below_minimum_reason(item)
    if lacking:
        add(lacking)
    if item.get("approval") == "Sent back":
        note = " ".join(str(item.get("rejection_note") or "").split())
        if note:
            add(_as_rejected(note))
    for activity in item.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        status = activity.get("status")
        explanation = activity.get("explanation") or activity.get("decision_reason")
        if status == "rejected" or activity.get("decision") == "rejected":
            add(_as_rejected(explanation or rejection_reason(activity)))
        elif status in {"invalid", "duplicate"}:
            add(explanation or rejection_reason(activity))
        elif status == "needs_review":
            if not explanation:
                for alert in activity.get("alerts") or []:
                    explanation = (alert or {}).get("explanation")
                    if explanation:
                        break
            add(explanation)
    for alert in item.get("alerts") or []:
        if not isinstance(alert, dict) or alert.get("code") == "BELOW_TARGET" or alert.get("activity_id"):
            continue
        add(alert.get("explanation"))
    if item.get("reader_failed") and not any("could not be read" in line.casefold() for line in lines):
        add(UNREAD_SCREENSHOT_NOTE)
    if not lines and item.get("approval") == "Pending management review":
        add("Submitted for management review.")
    if not lines:
        for text in item.get("rejection_reasons") or []:
            if _uploaded_but_not_counted(item) and "lacking " in str(text).casefold():
                continue
            add(text)
    if not lines and _uploaded_but_not_counted(item):
        add(UNREAD_SCREENSHOT_NOTE)
    if not lines:
        add("Needs review.")
    return lines


def review_log_order(items: list[dict]) -> list[dict]:
    """Needs review, sent back, and rejected evidence, newest first."""
    def stamp(item: dict) -> str:
        return str(item.get("latest_at") or item.get("submitted_at") or item.get("rejected_at") or "")

    return sorted((item for item in items if in_review_queue(item)), key=stamp, reverse=True)


def summarize(
    platform: str,
    classified: list[dict],
    *,
    screenshot_count: int,
    unclear_screenshots: list[dict],
    targets: list[dict],
    workday_ended: bool,
    approved: bool,
    submitted: bool,
) -> dict:
    """Roll classified activities into totals. There is no typed-count input."""
    categories = []
    alerts: list[dict] = []
    measured = any(bool(row.get("counted")) for row in classified)
    # Uploaded files with no verified activity are not a counted total of zero.
    counts_not_measured = screenshot_count > 0 and not measured
    reader_failed = counts_not_measured and len(unclear_screenshots) >= screenshot_count and not classified
    for shot in unclear_screenshots:
        alerts.append({
            **_alert("UNCLEAR_SCREENSHOT", shot.get("note") or UNREAD_SCREENSHOT_NOTE),
            "screenshot_id": shot.get("id"),
            "activity_id": None,
        })
    for target in targets:
        rows = [row for row in classified if row.get("activity_type") == target["key"]]
        verified = len([row for row in rows if row.get("counted")])
        duplicates = len([row for row in rows if row.get("status") == "duplicate"])
        invalid = len([row for row in rows if row.get("status") in {"invalid", "rejected"}])
        needs_review = len([row for row in rows if row.get("status") == "needs_review"])
        detected = len(rows)
        remaining = max(0, target["min"] - verified)
        categories.append({
            **target,
            "detected": detected,
            "duplicates": duplicates,
            "invalid": invalid,
            "needs_review": needs_review,
            "verified": verified,
            "remaining": remaining,
            "completion_pct": _completion(verified, target["min"]),
            "below_target": verified < target["min"],
        })
        if verified < target["min"] and (screenshot_count > 0 or workday_ended) and not counts_not_measured:
            shortfall = below_minimum_reason({"platform": platform, "categories": [{**target, "verified": verified}]})
            alerts.append({
                **_alert("BELOW_TARGET", shortfall or f"{target['label']} are below the minimum of {target['min']}. {verified} verified."),
                "screenshot_id": None,
                "activity_id": None,
            })
    for row in classified:
        for alert in row.get("alerts") or []:
            alerts.append({**alert, "screenshot_id": row.get("screenshot_id"), "activity_id": row.get("id")})
    if screenshot_count == 0 and (workday_ended or submitted):
        alerts.append({
            **_alert("MISSING_EVIDENCE", "No screenshot was uploaded for this task."),
            "screenshot_id": None,
            "activity_id": None,
        })
    pending = len(unclear_screenshots) + len([row for row in classified if row.get("status") == "needs_review"])
    status = overall_status(
        screenshot_count=screenshot_count,
        categories=categories,
        pending_review=pending,
        workday_ended=workday_ended,
        approved=approved,
        unreadable_screenshots=len(unclear_screenshots),
        reader_failed=reader_failed,
    )
    if categories:
        completion = round(sum(row["completion_pct"] for row in categories) / len(categories))
    else:
        completion = 0
    return {
        "platform": platform,
        "categories": categories,
        "status": status,
        "status_label": STATUS_LABELS[status],
        "completion_pct": completion,
        "pending_review": pending,
        "duplicate_count": sum(row["duplicates"] for row in categories),
        "invalid_count": sum(row["invalid"] for row in categories),
        "verified_total": sum(row["verified"] for row in categories),
        "alerts": alerts,
        "all_minimums_met": all(not row["below_target"] for row in categories) if categories else False,
        "counts_not_measured": counts_not_measured,
        "reader_failed": reader_failed,
        "unreadable_screenshots": len(unclear_screenshots),
    }


def manual_override(*, original: dict, decision: str, reason: str, actor_name: str, when: datetime) -> dict:
    """Management correction. The original automatic result is kept beside the reason."""
    cleaned = " ".join((reason or "").split())
    if decision not in {"approved", "rejected"}:
        raise ValueError("Choose approve or reject.")
    if not cleaned:
        raise ValueError("A reason is required for a manual override.")
    return {
        "action": decision,
        "reason": cleaned,
        "actor_name": actor_name,
        "at": when.isoformat(),
        "original_result": {
            "status": original.get("status"),
            "counted": bool(original.get("counted")),
            "alerts": original.get("alerts") or [],
            "explanation": original.get("explanation"),
        },
    }


def workday_has_ended(work_date: date, tz: ZoneInfo, now: datetime) -> bool:
    current = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return current.astimezone(tz).date() > work_date
