from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

AdapterState = Literal[
    "READY_FOR_CONNECTION_TEST",
    "INSTALLATION_NOT_FOUND",
    "INCOMPATIBLE",
    "UNSUPPORTED_PLATFORM",
]
ConnectionState = Literal[
    "NOT_TESTED",
    "VERIFIED",
    "TEST_IN_PROGRESS",
    "LAUNCH_IN_PROGRESS",
    "INSTALLATION_NOT_FOUND",
    "INCOMPATIBLE",
    "PROCESS_NOT_REACHABLE",
    "PROCESS_START_FAILED",
    "AUTHENTICATION_FAILED",
    "LICENSE_ERROR",
    "VERIFICATION_FAILED",
]


class LiveHealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["msku-ansys-local-bridge"] = "msku-ansys-local-bridge"
    version: str
    scope: Literal["localhost_only"] = "localhost_only"
    tokenConfigured: bool


class InstallationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    versionCode: int
    release: str
    productKind: Literal["student", "other"]
    executablePath: str
    source: str


class InstallationDiscoveryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str
    state: Literal["FOUND", "NOT_FOUND", "UNSUPPORTED_PLATFORM"]
    selected: InstallationResponse | None
    installations: list[InstallationResponse]
    warnings: list[str]


class CompatibilityResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Literal[
        "COMPATIBLE",
        "NOT_EVALUATED",
        "PYMECHANICAL_NOT_INSTALLED",
        "MECHANICAL_VERSION_UNSUPPORTED",
        "PYTHON_VERSION_UNSUPPORTED",
    ]
    pymechanicalVersion: str | None
    pythonVersion: str
    minimumMechanicalVersionCode: int
    message: str


class ConnectionTestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: ConnectionState
    processVerified: bool
    licenseVerified: bool
    startedByBridge: bool
    host: Literal["127.0.0.1"]
    port: int
    checkedAt: str | None
    mechanicalVersion: str | None
    productInfo: str | None
    errorCode: str | None
    message: str


class AdapterStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adapter: Literal["pymechanical"]
    state: AdapterState
    ansysConnected: bool
    simulationsEnabled: Literal[False]
    capabilities: list[str]
    message: str
    installation: InstallationDiscoveryResponse
    compatibility: CompatibilityResponse
    connection: ConnectionTestResponse


class ReadyHealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ready"] = "ready"
    service: Literal["msku-ansys-local-bridge"] = "msku-ansys-local-bridge"
    version: str
    adapterState: AdapterState
    ansysConnected: bool
    simulationsEnabled: Literal[False]


class BridgeStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ready"] = "ready"
    service: Literal["msku-ansys-local-bridge"] = "msku-ansys-local-bridge"
    version: str
    transport: Literal["localhost_token_wnua"] = "localhost_token_wnua"
    adapter: AdapterStatusResponse
    warnings: list[str]
