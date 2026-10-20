from __future__ import annotations

import ipaddress
import secrets
from collections.abc import Callable

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import BridgeSettings

TOKEN_HEADER = "X-MSKU-Bridge-Token"


def _is_loopback_client(host: str | None, *, allow_test_client: bool) -> bool:
    if host is None:
        return False
    if allow_test_client and host == "testclient":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class LocalOnlyMiddleware:
    """Reject non-loopback sockets and untrusted browser origins before routing."""

    def __init__(self, app: ASGIApp, *, settings: BridgeSettings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_host = client[0] if client else None
        if not _is_loopback_client(client_host, allow_test_client=self.settings.allow_test_client):
            response = JSONResponse({"detail": "Local bridge accepts loopback clients only."}, 403)
            await response(scope, receive, send)
            return

        request = Request(scope)
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in self.settings.allowed_origins:
            response = JSONResponse({"detail": "Browser origin is not allowed."}, 403)
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


def require_bridge_token(settings: BridgeSettings) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        if not settings.token_configured:
            response_detail = "Bridge token is not configured; restart with a generated token."
            raise HTTPException(status_code=503, detail=response_detail)
        supplied = request.headers.get(TOKEN_HEADER, "")
        if not secrets.compare_digest(supplied, settings.token or ""):
            raise HTTPException(status_code=401, detail="Invalid or missing bridge token.")

    return dependency
