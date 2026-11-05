"""Profile photos: accept a phone picture, store a small JPEG.

The browser may send JPG, PNG, HEIC/HEIF, WebP, GIF, or AVIF, including a
large original. We shrink it here so the saved file is a normal JPEG that
every browser can show. When the Railway bucket is configured, that JPEG
lives in the bucket and survives an API redeploy.
"""
import io

PROFILE_MAX_EDGE = 512
PROFILE_MAX_BYTES = 25 * 1024 * 1024
JPEG_QUALITY = 82
NOT_A_PHOTO = "Please choose a photo. JPG, PNG, HEIC, WebP, GIF, and AVIF all work."

_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
}
_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"}


def _extension(filename: str | None) -> str:
    name = (filename or "").lower().strip()
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def looks_like_photo(data: bytes, content_type: str | None = None, filename: str | None = None) -> bool:
    kind = (content_type or "").split(";")[0].strip().lower()
    if kind in _TYPES or _extension(filename) in _EXTENSIONS:
        return True
    if data[:3] == b"\xff\xd8\xff":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:16]
        return any(token in brand for token in (b"avif", b"avis", b"heic", b"heif", b"mif1", b"msf1"))
    return False


def prepare_profile_photo(data: bytes, content_type: str | None = None, filename: str | None = None) -> bytes:
    """Return a JPEG no larger than 512 px on the long edge."""
    if not data or not looks_like_photo(data, content_type, filename):
        raise ValueError(NOT_A_PHOTO)
    if len(data) > PROFILE_MAX_BYTES:
        raise ValueError("That photo is too large. Please choose one under 25 MB.")
    try:
        from PIL import Image, ImageOps

        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
        except Exception:
            pass
        try:
            import pillow_avif  # noqa: F401
        except Exception:
            pass
        img = Image.open(io.BytesIO(data))
        img.load()
        if getattr(img, "is_animated", False):
            img.seek(0)
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        if max(img.size) > PROFILE_MAX_EDGE:
            img.thumbnail((PROFILE_MAX_EDGE, PROFILE_MAX_EDGE), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        jpeg = out.getvalue()
        if not jpeg.startswith(b"\xff\xd8"):
            raise ValueError(NOT_A_PHOTO)
        return jpeg
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(NOT_A_PHOTO) from exc


def photo_media_type(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "image/avif"
    return "image/jpeg"
