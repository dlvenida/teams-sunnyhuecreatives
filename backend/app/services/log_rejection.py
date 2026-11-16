"""Reasons a reviewer must pick before sending a log back."""
from datetime import datetime, timezone

REJECT_REASONS = (
    "Below target count",
    "Wrong client",
    "Wrong platform",
    "Screenshot unreadable",
    "Cropped or blurry",
    "Duplicate or reused screenshot",
    "Date mismatch",
    "Other",
)


def clean_reasons(reasons) -> list[str]:
    picked: list[str] = []
    for item in reasons or []:
        text = " ".join(str(item or "").split())
        if text not in REJECT_REASONS:
            raise ValueError("Pick a reason from the list.")
        if text not in picked:
            picked.append(text)
    if not picked:
        raise ValueError("Pick at least one reason.")
    return picked


def clean_note(note) -> str | None:
    text = " ".join(str(note or "").split())
    if not text:
        return None
    if len(text) > 200:
        raise ValueError("Keep the note under 200 characters.")
    return text


def needs_fixing_text(reasons: list[str] | None, note: str | None) -> str:
    picked = [item for item in (reasons or []) if item]
    if not picked:
        return "No reason given"
    body = ", ".join(picked)
    extra = " ".join(str(note or "").split())
    if extra:
        return f"Needs fixing: {body}. Note: {extra}"
    return f"Needs fixing: {body}."


def last_sent_back_text(reasons: list[str] | None, note: str | None) -> str:
    picked = [item for item in (reasons or []) if item]
    if not picked:
        return "No reason given"
    body = ", ".join(picked)
    extra = " ".join(str(note or "").split())
    if extra:
        return f"Last sent back: {body}. Note: {extra}"
    return f"Last sent back: {body}."


def rejection_response(log) -> dict:
    history = []
    for row in rejection_rows(log):
        reasons = [str(item) for item in (row.reasons or [])]
        note = " ".join(str(row.note or "").split()) or None
        history.append({
            "reasons": reasons,
            "note": note,
            "rejected_by_name": " ".join(str(row.rejected_by_name or "").split()) or None,
            "rejected_at": row.rejected_at,
            "needs_fixing": needs_fixing_text(reasons, note),
            "last_sent_back": last_sent_back_text(reasons, note),
        })
    needs = None
    status = getattr(log.status, "value", log.status)
    if status == "rejected":
        needs = history[0]["needs_fixing"] if history else "No reason given"
    return {"needs_fixing": needs, "rejection_history": history}


def rejection_rows(log) -> list:
    rows = list(getattr(log, "rejections", None) or [])
    rows.sort(key=lambda row: row.rejected_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows
