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
    mechanical_port: int = 10000
    connection_timeout_seconds: int = 8

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
        mechanical_port = int(os.getenv("MSKU_ANSYS_MECHANICAL_PORT", "10000"))
        timeout_seconds = int(os.getenv("MSKU_ANSYS_CONNECTION_TIMEOUT_SECONDS", "8"))
        if not 1_024 <= mechanical_port <= 65_535:
            raise ValueError("MSKU_ANSYS_MECHANICAL_PORT must be between 1024 and 65535.")
        if not 1 <= timeout_seconds <= 30:
            raise ValueError("MSKU_ANSYS_CONNECTION_TIMEOUT_SECONDS must be between 1 and 30.")
        return cls(
            token=raw_token or None,
            allowed_origins=origins,
            mechanical_port=mechanical_port,
            connection_timeout_seconds=timeout_seconds,
        )
