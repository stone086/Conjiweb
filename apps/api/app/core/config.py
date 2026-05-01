from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://conjiweb:changeme@localhost:5432/conjiweb"
    REDIS_URL: str = "redis://localhost:6379/0"

    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "changeme123"
    MINIO_BUCKET: str = "conjiweb-files"
    MINIO_SECURE: bool = False

    SECRET_KEY: str = "supersecretkey"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    CORS_ORIGINS: List[str] = ["http://localhost:5173"]
    XMPP_DOMAIN: str = "localhost"
    XMPP_REGISTRATION_ENABLED: bool = True
    PUBLIC_DOMAIN: str = "localhost"
    FRONTEND_URL: str = ""
    AI_API_KEY: str = ""
    AI_BASE_URL: str = ""
    AI_MODEL: str = ""
    ALERT_EMAIL: str = ""
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800

    # SSO / OIDC
    OIDC_ENABLED: bool = False
    OIDC_ISSUER: str = ""
    OIDC_CLIENT_ID: str = ""
    OIDC_CLIENT_SECRET: str = ""
    OIDC_REDIRECT_URI: str = ""
    OIDC_LABEL: str = "Single Sign-On"
    AUTO_PROVISION_OIDC: bool = False

    # SSO / LDAP
    LDAP_ENABLED: bool = False
    LDAP_SERVER: str = ""
    LDAP_BIND_DN_TEMPLATE: str = "uid={username},ou=People,dc=example,dc=com"
    LDAP_USER_BASE: str = "ou=People,dc=example,dc=com"
    LDAP_LABEL: str = "Corporate Login"
    AUTO_PROVISION_LDAP: bool = False

    # Web Push (VAPID)
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_EMAIL: str = "admin@conjiweb.local"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
