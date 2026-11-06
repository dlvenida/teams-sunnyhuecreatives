"""Read an engagement screenshot into structured activities.

Counts are never invented. If the image cannot be read confidently, the result
is unclear and the caller flags it for review.
"""
from __future__ import annotations

import base64
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.config import settings
from app.services.engagement_rules import parse_extraction_payload

UNCLEAR_NOTE = "This screenshot could not be checked automatically. Nothing on it was counted."


def register_image_plugins() -> None:
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except Exception:
        pass
    try:
        import pillow_avif  # noqa: F401
    except Exception:
        pass


def to_jpeg(data: bytes) -> bytes | None:
    register_image_plugins()
    try:
        from PIL import Image, ImageOps

        img = Image.open(io.BytesIO(data))
        img.load()
        if getattr(img, "is_animated", False):
            img.seek(0)
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
        return out.getvalue()
    except Exception:
        return None


def _unclear(note: str = UNCLEAR_NOTE) -> dict:
    return {"platform": None, "account": None, "readable": False, "activities": [], "note": note}


def _vision_reader(jpeg: bytes) -> dict | None:
    key = (settings.grok_api_key or "").strip()
    if not key:
        return None
    model = (settings.engagement_vision_model or settings.grok_model or "").strip()
    if not model:
        return None
    prompt = (
        "Read this social media screenshot. Reply with JSON only, no markdown. "
        "Use null when a value is not visible. Do not guess dates, times, usernames, or counts. "
        "confidence is high only when the activity, date, time, and username (when shown) are fully visible. "
        "type is one of dm, comment, share, connect, draft, unknown. "
        "share_evidence is true only when a Facebook entry clearly shows a share. "
        "Do not treat connection requests as comments. "
        '{"platform":"instagram|facebook|linkedin|unknown","account":null,"readable":true,'
        '"activities":[{"type":"comment","username":null,"date":null,"time":null,"text":null,'
        '"confidence":"low","share_evidence":null}]}'
    )
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")}},
                ],
            }
        ],
    }
    try:
        import httpx

        response = httpx.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
    except Exception:
        return None
    return _parse_reader_text(content)


def _parse_reader_text(content: str) -> dict | None:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[: text.rfind("```")]
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    parsed = parse_extraction_payload(data)
    if not parsed["activities"]:
        return _unclear(parsed.get("note") or UNCLEAR_NOTE)
    return parsed


def _tesseract_text(jpeg: bytes) -> str | None:
    if not shutil.which("tesseract"):
        return None
    try:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "shot.jpg"
            path.write_bytes(jpeg)
            result = subprocess.run(
                ["tesseract", str(path), "stdout"],
                capture_output=True,
                timeout=30,
                check=False,
            )
        if result.returncode != 0:
            return None
        return result.stdout.decode("utf-8", errors="ignore")
    except Exception:
        return None


def extract_from_image(data: bytes) -> dict:
    """Best-effort read. Low confidence or failure returns no counted activities."""
    jpeg = to_jpeg(data)
    if not jpeg:
        return _unclear("That file is not a readable image. Use JPG, PNG, WEBP, or HEIC.")
    vision = _vision_reader(jpeg)
    if vision and vision.get("activities"):
        return vision
    text = _tesseract_text(jpeg)
    if text and "type:" in text.casefold() and "---" in text:
        from app.services.engagement_rules import parse_extraction_document

        parsed = parse_extraction_document(text)
        if parsed["activities"]:
            return parsed
    return _unclear()
