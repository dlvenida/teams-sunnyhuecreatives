from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://shc:shc@localhost:5440/shc"
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_access_expire_minutes: int = 60
    jwt_refresh_expire_days: int = 7
    admin_email: str = "janelaurine@gmail.com"
    admin_password: str = "admin123"
    resend_api_key: str = ""
    resend_from_email: str = "onboarding@resend.dev"
    admin_notify_email: str = "janelaurine@gmail.com"
    cors_origins: str = "http://localhost:5190"
    app_url: str = "http://localhost:5190"
    uploads_dir: str = "uploads"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
