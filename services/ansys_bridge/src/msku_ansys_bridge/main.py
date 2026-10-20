from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool

from . import __version__
from .adapter import AnsysAdapter, ConnectionTestResult, LocalAnsysAdapter
from .config import BridgeSettings
from .models import (
    AdapterStatusResponse,
    BridgeStatusResponse,
    CompatibilityResponse,
    ConnectionTestResponse,
    InstallationDiscoveryResponse,
    InstallationResponse,
    LiveHealthResponse,
    ReadyHealthResponse,
)
from .security import TOKEN_HEADER, LocalOnlyMiddleware, require_bridge_token


def _connection_response(result: ConnectionTestResult) -> ConnectionTestResponse:
    return ConnectionTestResponse(
        state=result.state,
        processVerified=result.process_verified,
        licenseVerified=result.license_verified,
        startedByBridge=result.started_by_bridge,
        host=result.host,
        port=result.port,
        checkedAt=result.checked_at,
        mechanicalVersion=result.mechanical_version,
        productInfo=result.product_info,
        errorCode=result.error_code,
        message=result.message,
    )


def create_app(
    settings: BridgeSettings | None = None,
    adapter: AnsysAdapter | None = None,
) -> FastAPI:
    active_settings = settings or BridgeSettings.from_environment()
    active_adapter = adapter or LocalAnsysAdapter(active_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await run_in_threadpool(active_adapter.close)

    application = FastAPI(
        title="MSKU Racing ANSYS Local Bridge",
        version=__version__,
        description=(
            "Localhost-only Phase 2 discovery and verified-connection bridge. This service "
            "does not run ANSYS simulations and is never a Vercel function."
        ),
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
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
        selected = adapter_status.discovery.selected
        installation_response = InstallationDiscoveryResponse(
            platform=adapter_status.discovery.platform,
            state=adapter_status.discovery.state,
            selected=(
                InstallationResponse(
                    versionCode=selected.version_code,
                    release=selected.release,
                    productKind=selected.product_kind,
                    executablePath=str(selected.executable),
                    source=selected.source,
                )
                if selected
                else None
            ),
            installations=[
                InstallationResponse(
                    versionCode=item.version_code,
                    release=item.release,
                    productKind=item.product_kind,
                    executablePath=str(item.executable),
                    source=item.source,
                )
                for item in adapter_status.discovery.installations
            ],
            warnings=list(adapter_status.discovery.warnings),
        )
        compatibility_response = CompatibilityResponse(
            state=adapter_status.compatibility.state,
            pymechanicalVersion=adapter_status.compatibility.pymechanical_version,
            pythonVersion=adapter_status.compatibility.python_version,
            minimumMechanicalVersionCode=(
                adapter_status.compatibility.minimum_mechanical_version_code
            ),
            message=adapter_status.compatibility.message,
        )
        return BridgeStatusResponse(
            version=__version__,
            adapter=AdapterStatusResponse(
                adapter=adapter_status.adapter,
                state=adapter_status.state,
                ansysConnected=adapter_status.ansys_connected,
                simulationsEnabled=adapter_status.simulations_enabled,
                capabilities=list(adapter_status.capabilities),
                message=adapter_status.message,
                installation=installation_response,
                compatibility=compatibility_response,
                connection=_connection_response(adapter_status.connection),
            ),
            warnings=[
                *([] if adapter_status.ansys_connected else ["REAL_ANSYS_NOT_CONNECTED"]),
                "SIMULATION_ENDPOINTS_NOT_IMPLEMENTED",
                "ANSYS_STUDENT_LICENSE_AND_MODEL_LIMITS_APPLY",
                *adapter_status.discovery.warnings,
            ],
        )

    @application.post(
        "/bridge/v1/connection/test",
        response_model=ConnectionTestResponse,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def test_connection() -> ConnectionTestResponse:
        result = await run_in_threadpool(active_adapter.test_connection)
        return _connection_response(result)

    @application.post(
        "/bridge/v1/connection/launch",
        response_model=ConnectionTestResponse,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def launch_connection() -> ConnectionTestResponse:
        result = await run_in_threadpool(active_adapter.launch_connection)
        return _connection_response(result)

    return application


app = create_app()
