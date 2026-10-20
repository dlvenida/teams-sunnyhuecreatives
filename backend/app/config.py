from pydantic import AliasChoices, Field
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
    # Grok (xAI) — admin-only agent. Set XAI_API_KEY (or GROK_API_KEY) to enable live Grok replies.
    grok_api_key: str = Field(default="", validation_alias=AliasChoices("XAI_API_KEY", "GROK_API_KEY"))
    grok_model: str = Field(default="grok-4", validation_alias=AliasChoices("GROK_MODEL", "XAI_MODEL"))
    # Headless agent control API for the owner's Grok Bot (X-Agent-Key header). Admin JWT also works.
    agent_api_key: str = Field(default="", validation_alias=AliasChoices("AGENT_API_KEY", "GROKBOT_API_KEY"))

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
