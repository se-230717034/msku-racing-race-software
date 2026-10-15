from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Vec3(StrictModel):
    x: float
    y: float
    z: float


class Hardpoint(StrictModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    group: Literal["upper_wishbone", "lower_wishbone", "steering", "upright", "wheel"]
    position: Vec3


class Wheel(StrictModel):
    radius: float = Field(gt=0)
    width: float = Field(gt=0)
    staticCamberRad: float = Field(default=0.0, ge=-0.35, le=0.35)
    staticToeRad: float = Field(default=0.0, ge=-0.35, le=0.35)


class Suspension(StrictModel):
    type: Literal["double_wishbone"]
    corner: Literal["front_left", "front_right"]
    hardpoints: list[Hardpoint] = Field(min_length=9, max_length=9)
    wheel: Wheel

    @model_validator(mode="after")
    def hardpoint_ids_are_unique(self) -> Suspension:
        ids = [point.id for point in self.hardpoints]
        if len(ids) != len(set(ids)):
            raise ValueError("hardpoint identifiers must be unique")
        return self


class Units(StrictModel):
    length: Literal["m"]
    angle: Literal["rad"]


class CoordinateSystem(StrictModel):
    handedness: Literal["right"]
    xAxis: Literal["forward"]
    yAxis: Literal["left"]
    zAxis: Literal["up"]


class Project(StrictModel):
    schemaVersion: Literal["1.0.0"]
    projectId: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=500)
    createdAt: datetime
    updatedAt: datetime
    dataClassification: Literal["demonstration", "team_private"]
    modelStatus: Literal["demonstration", "unvalidated", "benchmarked", "experimentally_validated"]
    units: Units
    coordinateSystem: CoordinateSystem
    suspension: Suspension


class DiagnosticResponse(StrictModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    points: list[str]


class ProjectValidationResponse(StrictModel):
    valid: bool
    schemaVersion: Literal["1.0.0"]
    units: dict[str, str]
    diagnostics: list[DiagnosticResponse]


class SweepDefinition(StrictModel):
    startTravelM: float = Field(default=-0.05, ge=-0.25, le=0.25)
    endTravelM: float = Field(default=0.05, ge=-0.25, le=0.25)
    steps: int = Field(default=41, ge=3, le=401)

    @model_validator(mode="after")
    def travel_range_is_increasing(self) -> SweepDefinition:
        if self.endTravelM <= self.startTravelM:
            raise ValueError("endTravelM must be greater than startTravelM")
        return self


class SolverConfiguration(StrictModel):
    residualToleranceM: float = Field(default=1.0e-8, ge=1.0e-12, le=1.0e-4)
    maxFunctionEvaluations: int = Field(default=500, ge=50, le=5000)


class KinematicsSweepRequest(StrictModel):
    project: Project
    sweep: SweepDefinition = Field(default_factory=SweepDefinition)
    solver: SolverConfiguration = Field(default_factory=SolverConfiguration)


class SolverDiagnosticsResponse(StrictModel):
    converged: bool
    residualNormM: float | None
    maxAbsResidualM: float | None
    jacobianRank: int
    jacobianCondition: float | None
    functionEvaluations: int
    message: str


class KinematicMetricsResponse(StrictModel):
    camberRad: float
    camberChangeRad: float
    camberGainRadPerM: float | None
    toeRad: float
    bumpSteerRad: float
    bumpSteerGradientRadPerM: float | None
    casterRad: float
    kpiRad: float
    trackChangeM: float
    rollCenterHeightM: float | None
    instantCenterYM: float | None
    instantCenterZM: float | None


class KinematicPoseResponse(StrictModel):
    hardpoints: dict[str, Vec3]
    wheelAxis: Vec3
    translation: Vec3
    rotationVector: Vec3


class KinematicStateResponse(StrictModel):
    travelM: float
    pose: KinematicPoseResponse | None
    metrics: KinematicMetricsResponse | None
    diagnostics: SolverDiagnosticsResponse
    warnings: list[str]


class KinematicsSweepResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    modelStatus: Literal["unvalidated"]
    units: dict[str, str]
    allConverged: bool
    residualToleranceM: float
    states: list[KinematicStateResponse]
