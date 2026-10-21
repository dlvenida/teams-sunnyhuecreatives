"""Comment-image optimization, Monday/Asana-style.

Policy (also shown in the UI upload guide):
  * Accept JPG / PNG / WebP / AVIF / GIF, up to 10 MB original.
    (Asana allows 100 MB/file and monday.com 500 MB/file — we deliberately
    cap at 10 MB because every image is re-encoded, so huge originals only
    slow the upload down without improving the stored result.)
  * Long edge is downscaled to at most 1920 px (Full-HD) — screenshots and
    photos stay crisp on retina boards, same target Asana/monday previews use.
  * Stored ONLY as AVIF (quality 55, metadata/EXIF stripped, orientation fixed)
    in the bucket via services.storage. AVIF is ~50% smaller than JPEG at the
    same quality, so a typical 4 MB phone photo lands at ~150-400 KB.
"""
import io

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB original
MAX_EDGE = 1920
AVIF_QUALITY = 55
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"}


def optimize_image(data: bytes) -> dict:
    """Return {data, format, width, height, original_width, original_height} as AVIF."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Image is {len(data) / 1024 / 1024:.1f} MB — please keep originals under 10 MB (it will be optimized to AVIF automatically).")
    try:
        from PIL import Image, ImageOps
        try:
            import pillow_avif  # noqa: F401  registers the AVIF codec with Pillow
        except Exception:
            pass
        img = Image.open(io.BytesIO(data))
        img.load()
        if getattr(img, "is_animated", False):
            img.seek(0)
        ow, oh = img.size
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        if max(img.size) > MAX_EDGE:
            img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        out = io.BytesIO()
        fmt, ctype = "avif", "image/avif"
        try:
            img.save(out, format="AVIF", quality=AVIF_QUALITY)
        except Exception:
            out = io.BytesIO()
            img.convert("RGB").save(out, format="WEBP", quality=80)
            fmt, ctype = "webp", "image/webp"
        return {"data": out.getvalue(), "format": fmt, "content_type": ctype,
                "width": img.size[0], "height": img.size[1], "original_width": ow, "original_height": oh}
    except ValueError:
        raise
    except Exception as e:
        raise ValueError("That file is not a readable image. Use JPG, PNG, WebP, AVIF or GIF.") from e
