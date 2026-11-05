"""Profile photos accept common camera files and store a small JPEG."""
import asyncio
import io
import unittest
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image
from starlette.datastructures import Headers, UploadFile

from app.services.profile_photo import NOT_A_PHOTO, PROFILE_MAX_EDGE, prepare_profile_photo


def _upload(data: bytes, name: str, content_type: str) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


def _jpeg(width: int, height: int, color=(20, 80, 140)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _encoded(fmt: str, size=(48, 32), **save_kwargs) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (180, 40, 90)).save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()


class PrepareTests(unittest.TestCase):
    def test_each_common_format_becomes_a_small_jpeg(self):
        try:
            import pillow_avif  # noqa: F401
        except Exception:
            pillow_avif = None
        import pillow_heif

        pillow_heif.register_heif_opener()
        samples = {
            "photo.jpg": ("image/jpeg", _jpeg(80, 60)),
            "photo.png": ("image/png", _encoded("PNG")),
            "photo.webp": ("image/webp", _encoded("WEBP")),
            "photo.gif": ("image/gif", _encoded("GIF")),
            "photo.heic": ("image/heic", _encoded("HEIF")),
        }
        if pillow_avif is not None:
            samples["photo.avif"] = ("image/avif", _encoded("AVIF"))
        for name, (content_type, raw) in samples.items():
            with self.subTest(name=name):
                jpeg = prepare_profile_photo(raw, content_type, name)
                self.assertTrue(jpeg.startswith(b"\xff\xd8"))
                opened = Image.open(io.BytesIO(jpeg))
                self.assertLessEqual(max(opened.size), PROFILE_MAX_EDGE)

    def test_a_15mb_phone_photo_is_shrunk(self):
        small = _jpeg(2400, 1800)
        payload = small + (b"\x00" * (15 * 1024 * 1024 - len(small)))
        self.assertGreaterEqual(len(payload), 15 * 1024 * 1024)
        jpeg = prepare_profile_photo(payload, "image/jpeg", "IMG_0001.JPG")
        self.assertLess(len(jpeg), 200 * 1024)
        opened = Image.open(io.BytesIO(jpeg))
        self.assertLessEqual(max(opened.size), PROFILE_MAX_EDGE)

    def test_a_text_file_gets_a_friendly_error(self):
        with self.assertRaises(ValueError) as raised:
            prepare_profile_photo(b"not a photo", "text/plain", "notes.txt")
        self.assertEqual(str(raised.exception), NOT_A_PHOTO)


class UploadTests(unittest.TestCase):
    def test_admin_and_va_can_upload_even_when_a_password_change_is_required(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser
        from app.models import Currency, User, UserRole, VA
        from app.routers.profile import get_profile_photo, upload_profile_photo
        from app.services import storage

        db = SessionLocal()
        created = []
        try:
            admin = db.query(User).filter(User.role == UserRole.admin, User.is_active.is_(True)).first()
            self.assertIsNotNone(admin)
            people = [("admin", admin, None)]
            va_user = User(
                email=f"photo-{uuid4().hex[:8]}@sunnyhue.local",
                password_hash="not-used",
                role=UserRole.va,
                display_name="Photo VA",
                is_active=True,
                must_change_password=True,
            )
            db.add(va_user)
            db.flush()
            va = VA(user_id=va_user.id, name="Photo VA", currency=Currency.PHP, is_active=True)
            db.add(va)
            db.commit()
            created.append((va_user, va))
            people.append(("va", va_user, va.id))

            saved_flag = admin.must_change_password
            saved_path = admin.profile_photo_path
            admin.must_change_password = True
            db.commit()
            try:
                for label, user, va_id in people:
                    with self.subTest(role=label):
                        user.must_change_password = True
                        db.commit()
                        current = CurrentUser(user=user, va_id=va_id)
                        result = asyncio.run(upload_profile_photo(
                            current,
                            db,
                            _upload(_jpeg(1400, 900), "camera.jpg", "image/jpeg"),
                        ))
                        self.assertTrue(result["has_profile_photo"])
                        self.assertTrue(user.must_change_password)
                        response = get_profile_photo(current)
                        self.assertEqual(response.media_type, "image/jpeg")
                        self.assertTrue(response.body.startswith(b"\xff\xd8"))
                        self.assertTrue(user.profile_photo_path)
                        self.assertIsNotNone(storage.read_bytes(f"profiles/{user.id}.jpg"))
            finally:
                admin.must_change_password = saved_flag
                admin.profile_photo_path = saved_path
                storage.delete(f"profiles/{admin.id}.jpg")
                db.commit()
            for user, va in created:
                storage.delete(f"profiles/{user.id}.jpg")
                db.delete(va)
                db.delete(user)
            db.commit()
        finally:
            db.rollback()
            db.close()

    def test_upload_rejects_a_non_image_with_the_friendly_message(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser
        from app.models import User, UserRole
        from app.routers.profile import upload_profile_photo

        db = SessionLocal()
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(upload_profile_photo(
                    CurrentUser(user=admin),
                    db,
                    _upload(b"hello", "notes.txt", "text/plain"),
                ))
            self.assertEqual(raised.exception.status_code, 400)
            self.assertEqual(raised.exception.detail, NOT_A_PHOTO)
        finally:
            db.rollback()
            db.close()
