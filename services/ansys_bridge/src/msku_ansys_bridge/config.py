from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "https://msku-racing-race-software.vercel.app",
)


@dataclass(frozen=True, slots=True)
class BridgeSettings:
    """Security settings for one local bridge process."""

    token: str | None
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS
    allow_test_client: bool = False

    @property
    def token_configured(self) -> bool:
        return self.token is not None and len(self.token) >= 32

    @classmethod
    def from_environment(cls) -> BridgeSettings:
        raw_token = os.getenv("MSKU_ANSYS_BRIDGE_TOKEN", "").strip()
        origins = tuple(
            origin.strip().rstrip("/")
            for origin in os.getenv(
                "MSKU_ANSYS_BRIDGE_ALLOWED_ORIGINS",
                ",".join(DEFAULT_ALLOWED_ORIGINS),
            ).split(",")
            if origin.strip()
        )
        return cls(token=raw_token or None, allowed_origins=origins)
