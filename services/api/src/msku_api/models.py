from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


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


class Suspension(StrictModel):
    type: Literal["double_wishbone"]
    corner: Literal["front_left"]
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
