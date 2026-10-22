"""Declared Dynamics Studio to local CAD coordinate transfer.

This proves arithmetic and agreement with user-supplied anchor coordinates;
it cannot prove that those anchors belong to the imported CAD topology.
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Axis = Literal["+X", "-X", "+Y", "-Y", "+Z", "-Z"]
Corner = Literal["front_left", "front_right", "rear_left", "rear_right"]
REQUIRED_HARDPOINTS = frozenset(
    {
        "uca_front_inboard",
        "uca_rear_inboard",
        "uca_outboard",
        "lca_front_inboard",
        "lca_rear_inboard",
        "lca_outboard",
        "tie_rod_inboard",
        "tie_rod_outboard",
        "wheel_center",
    }
)


class Vector3(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    z: float = Field(allow_inf_nan=False)

    def components(self) -> tuple[float, float, float]:
        return self.x, self.y, self.z


class CadFrameDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Each CAD axis is a signed vehicle axis. Only proper rotations are accepted.
    cadAxesFromVehicle: tuple[Axis, Axis, Axis]
    cadOriginVehicleM: Vector3
    anchorsCadMm: dict[str, Vector3] = Field(min_length=3, max_length=9)
    anchorToleranceMm: float = Field(ge=0.001, le=10, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid_axes(self) -> CadFrameDeclaration:
        axes = self.cadAxesFromVehicle
        if {axis[1] for axis in axes} != {"X", "Y", "Z"}:
            raise ValueError("CAD axes must use each vehicle axis exactly once")
        matrix = self.rotation_matrix()
        determinant = (
            matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
            - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
            + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
        )
        if determinant != 1:
            raise ValueError("CAD frame must preserve handedness (determinant +1)")
        return self

    def rotation_matrix(self) -> tuple[tuple[int, int, int], ...]:
        indices = {"X": 0, "Y": 1, "Z": 2}
        rows: list[tuple[int, int, int]] = []
        for axis in self.cadAxesFromVehicle:
            row = [0, 0, 0]
            row[indices[axis[1]]] = 1 if axis[0] == "+" else -1
            rows.append((row[0], row[1], row[2]))
        return tuple(rows)

    def to_cad_mm(self, point: Vector3) -> Vector3:
        relative = [
            a - b
            for a, b in zip(point.components(), self.cadOriginVehicleM.components(), strict=True)
        ]
        transformed = [
            1000 * sum(axis * component for axis, component in zip(row, relative, strict=True))
            for row in self.rotation_matrix()
        ]
        return Vector3(x=transformed[0], y=transformed[1], z=transformed[2])


class StudioTransfer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projectId: str = Field(min_length=1, max_length=120)
    projectName: str = Field(min_length=1, max_length=120)
    cornerId: Corner
    dataClassification: Literal["demonstration", "team_private"]
    geometrySource: Literal["independent", "mirrored_assumption", "synthetic_demo"]
    sourceLabel: str = Field(min_length=1, max_length=300)
    hardpointsM: dict[str, Vector3]
    cadFrame: CadFrameDeclaration

    @model_validator(mode="after")
    def validate_registration(self) -> StudioTransfer:
        if set(self.hardpointsM) != REQUIRED_HARDPOINTS:
            raise ValueError("Studio transfer requires exactly the nine corner hardpoints")
        if not set(self.cadFrame.anchorsCadMm).issubset(self.hardpointsM):
            raise ValueError("CAD anchors must refer to transferred hardpoints")
        anchors = list(self.cadFrame.anchorsCadMm)
        origin = self.hardpointsM[anchors[0]].components()
        directions = [
            tuple(
                value - base
                for value, base in zip(self.hardpointsM[key].components(), origin, strict=True)
            )
            for key in anchors[1:]
        ]
        if not any(
            math.dist(
                (0.0, 0.0, 0.0),
                (
                    first[1] * second[2] - first[2] * second[1],
                    first[2] * second[0] - first[0] * second[2],
                    first[0] * second[1] - first[1] * second[0],
                ),
            )
            > 1e-8
            for index, first in enumerate(directions)
            for second in directions[index + 1 :]
        ):
            raise ValueError("CAD anchors must include three non-collinear vehicle points")
        if self.max_anchor_residual_mm() > self.cadFrame.anchorToleranceMm:
            raise ValueError("Declared CAD anchor coordinates do not match the frame transform")
        return self

    def converted_hardpoints_mm(self) -> dict[str, Vector3]:
        return {key: self.cadFrame.to_cad_mm(value) for key, value in self.hardpointsM.items()}

    def max_anchor_residual_mm(self) -> float:
        converted = self.converted_hardpoints_mm()
        return max(
            math.dist(converted[key].components(), anchor.components())
            for key, anchor in self.cadFrame.anchorsCadMm.items()
        )


class StudioTransferEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projectId: str
    cornerId: Corner
    dataClassification: Literal["demonstration", "team_private"]
    geometrySource: Literal["independent", "mirrored_assumption", "synthetic_demo"]
    sourceLabel: str
    hardpointsCadMm: dict[str, Vector3]
    maxDeclaredAnchorResidualMm: float
    status: Literal["DECLARED_ANCHORS_MATCHED_NOT_CAD_VERIFIED"] = (
        "DECLARED_ANCHORS_MATCHED_NOT_CAD_VERIFIED"
    )


def transfer_evidence(transfer: StudioTransfer) -> StudioTransferEvidence:
    return StudioTransferEvidence(
        projectId=transfer.projectId,
        cornerId=transfer.cornerId,
        dataClassification=transfer.dataClassification,
        geometrySource=transfer.geometrySource,
        sourceLabel=transfer.sourceLabel,
        hardpointsCadMm=transfer.converted_hardpoints_mm(),
        maxDeclaredAnchorResidualMm=transfer.max_anchor_residual_mm(),
    )
