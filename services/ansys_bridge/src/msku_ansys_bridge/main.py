from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .adapter import AnsysAdapter, MockAnsysAdapter
from .config import BridgeSettings
from .models import (
    AdapterStatusResponse,
    BridgeStatusResponse,
    LiveHealthResponse,
    ReadyHealthResponse,
)
from .security import TOKEN_HEADER, LocalOnlyMiddleware, require_bridge_token


def create_app(
    settings: BridgeSettings | None = None,
    adapter: AnsysAdapter | None = None,
) -> FastAPI:
    active_settings = settings or BridgeSettings.from_environment()
    active_adapter = adapter or MockAnsysAdapter()
    application = FastAPI(
        title="MSKU Racing ANSYS Local Bridge",
        version=__version__,
        description=(
            "Localhost-only Phase 1 connection bridge. This service does not run ANSYS "
            "simulations and is never a Vercel function."
        ),
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=[TOKEN_HEADER, "Content-Type"],
        allow_private_network=True,
        max_age=600,
    )
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"],
    )
    application.add_middleware(LocalOnlyMiddleware, settings=active_settings)

    @application.get("/bridge/v1/health/live", response_model=LiveHealthResponse)
    async def live_health() -> LiveHealthResponse:
        return LiveHealthResponse(
            version=__version__, tokenConfigured=active_settings.token_configured
        )

    @application.get(
        "/bridge/v1/health/ready",
        response_model=ReadyHealthResponse,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def ready_health() -> ReadyHealthResponse:
        adapter_status = active_adapter.status()
        return ReadyHealthResponse(
            version=__version__,
            adapterState=adapter_status.state,
            ansysConnected=adapter_status.ansys_connected,
            simulationsEnabled=adapter_status.simulations_enabled,
        )

    @application.get(
        "/bridge/v1/status",
        response_model=BridgeStatusResponse,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def bridge_status() -> BridgeStatusResponse:
        adapter_status = active_adapter.status()
        return BridgeStatusResponse(
            version=__version__,
            adapter=AdapterStatusResponse(
                adapter=adapter_status.adapter,
                state=adapter_status.state,
                ansysConnected=adapter_status.ansys_connected,
                simulationsEnabled=adapter_status.simulations_enabled,
                capabilities=list(adapter_status.capabilities),
                message=adapter_status.message,
            ),
            warnings=[
                "MOCK_ADAPTER_ONLY",
                "REAL_ANSYS_NOT_CONNECTED",
                "SIMULATION_ENDPOINTS_NOT_IMPLEMENTED",
            ],
        )

    return application


app = create_app()
