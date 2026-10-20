from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class LiveHealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["msku-ansys-local-bridge"] = "msku-ansys-local-bridge"
    version: str
    scope: Literal["localhost_only"] = "localhost_only"
    tokenConfigured: bool


class AdapterStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adapter: Literal["mock"]
    state: Literal["MOCK_READY"]
    ansysConnected: bool
    simulationsEnabled: bool
    capabilities: list[str]
    message: str


class ReadyHealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ready"] = "ready"
    service: Literal["msku-ansys-local-bridge"] = "msku-ansys-local-bridge"
    version: str
    adapterState: Literal["MOCK_READY"]
    ansysConnected: bool
    simulationsEnabled: bool


class BridgeStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ready"] = "ready"
    service: Literal["msku-ansys-local-bridge"] = "msku-ansys-local-bridge"
    version: str
    transport: Literal["localhost_token"] = "localhost_token"
    adapter: AdapterStatusResponse
    warnings: list[str]
