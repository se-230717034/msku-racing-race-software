from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import __version__
from .adapter import AnsysAdapter, ConnectionTestResult, LocalAnsysAdapter
from .analysis import AnalysisError, StaticAnalysisManager, StaticAnalysisRequest, StaticJobResponse
from .config import BridgeSettings
from .modal import ModalAnalysisManager, ModalAnalysisRequest, ModalJobResponse
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
from .reporting import build_modal_report, build_static_report
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
    analysis_manager = StaticAnalysisManager(active_adapter)
    modal_manager = ModalAnalysisManager(active_adapter)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await run_in_threadpool(active_adapter.close)

    application = FastAPI(
        title="MSKU Racing ANSYS Local Bridge",
        version=__version__,
        description=(
            "Localhost-only ANSYS bridge. Static Structural runs only after an explicit "
            "authenticated request in a bridge-owned Mechanical process; never on Vercel."
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
                "STATIC_STRUCTURAL_REQUIRES_EXPLICIT_LOCAL_ACTION",
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

    @application.post(
        "/bridge/v1/analyses/static-structural",
        response_model=StaticJobResponse,
        status_code=202,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def start_static_structural(request: StaticAnalysisRequest) -> StaticJobResponse:
        try:
            return analysis_manager.start(request)
        except AnalysisError as exc:
            raise HTTPException(
                status_code=409 if exc.code == "ANALYSIS_ALREADY_RUNNING" else 422,
                detail={"code": exc.code, "message": exc.message},
            ) from exc

    @application.get(
        "/bridge/v1/analyses/static-structural/{job_id}",
        response_model=StaticJobResponse,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def static_structural_status(job_id: str) -> StaticJobResponse:
        job = analysis_manager.snapshot(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Analiz işi bulunamadı.")
        return job

    @application.get(
        "/bridge/v1/analyses/static-structural/{job_id}/report",
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def static_structural_report(job_id: str) -> JSONResponse:
        source = analysis_manager.report_source(job_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Tamamlanmış analiz raporu bulunamadı.")
        try:
            report = build_static_report(*source)
        except ValueError as exc:
            raise HTTPException(
                status_code=409, detail="Analiz kanıtı rapor için yetersiz."
            ) from exc
        return JSONResponse(
            report.model_dump(mode="json"),
            headers={
                "Content-Disposition": (
                    f'attachment; filename="msku-ansys-static-{report.jobId}.json"'
                ),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @application.post(
        "/bridge/v1/analyses/modal",
        response_model=ModalJobResponse,
        status_code=202,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def start_modal(request: ModalAnalysisRequest) -> ModalJobResponse:
        try:
            return modal_manager.start(request)
        except AnalysisError as exc:
            raise HTTPException(
                status_code=409 if exc.code == "ANALYSIS_ALREADY_RUNNING" else 422,
                detail={"code": exc.code, "message": exc.message},
            ) from exc

    @application.get(
        "/bridge/v1/analyses/modal/{job_id}",
        response_model=ModalJobResponse,
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def modal_status(job_id: str) -> ModalJobResponse:
        job = modal_manager.snapshot(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Modal analiz işi bulunamadı.")
        return job

    @application.get(
        "/bridge/v1/analyses/modal/{job_id}/report",
        dependencies=[Depends(require_bridge_token(active_settings))],
    )
    async def modal_report(job_id: str) -> JSONResponse:
        source = modal_manager.report_source(job_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Tamamlanmış modal rapor bulunamadı.")
        try:
            report = build_modal_report(*source)
        except ValueError as exc:
            raise HTTPException(
                status_code=409, detail="Modal kanıtı rapor için yetersiz."
            ) from exc
        return JSONResponse(
            report.model_dump(mode="json"),
            headers={
                "Content-Disposition": (
                    f'attachment; filename="msku-ansys-modal-{report.jobId}.json"'
                ),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    return application


app = create_app()
