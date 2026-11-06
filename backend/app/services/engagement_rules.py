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
                "explanation": item.get("decision_reason") or "Management rejected this activity.",
                "username_key": normalize_profile(item.get("username")),
            })
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
                "explanation": blocking[0]["explanation"],
            })
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
) -> str:
    if screenshot_count == 0:
        return "incomplete" if workday_ended else "not_started"
    mins_met = all(row["verified"] >= row["min"] for row in categories) if categories else False
    any_over = any(row["verified"] > row["max"] for row in categories)
    if approved and mins_met and pending_review == 0:
        return "completed"
    if pending_review > 0:
        return "needs_review"
    if mins_met and any_over:
        return "target_exceeded"
    if mins_met:
        return "target_met"
    if workday_ended:
        return "incomplete"
    return "in_progress"


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
    for shot in unclear_screenshots:
        alerts.append({
            **_alert("UNCLEAR_SCREENSHOT", shot.get("note") or "This screenshot could not be read. Nothing on it was counted."),
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
        if verified < target["min"] and (workday_ended or submitted):
            alerts.append({
                **_alert("BELOW_TARGET", f"{target['label']} are below the minimum of {target['min']}. {verified} verified."),
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
