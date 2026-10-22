from __future__ import annotations

import pytest
from msku_ansys_bridge.studio_transfer import (
    REQUIRED_HARDPOINTS,
    CadFrameDeclaration,
    StudioTransfer,
    transfer_evidence,
)
from pydantic import ValidationError


def payload() -> dict[str, object]:
    points = {
        name: {"x": 1.0 + index * 0.01, "y": 0.5, "z": 0.3}
        for index, name in enumerate(sorted(REQUIRED_HARDPOINTS))
    }
    points["wheel_center"] = {"x": 1.2, "y": 0.7, "z": 0.25}
    points["uca_outboard"] = {"x": 1.0, "y": 0.65, "z": 0.45}
    points["lca_outboard"] = {"x": 1.0, "y": 0.65, "z": 0.2}
    return {
        "projectId": "demo-1",
        "projectName": "DEMO suspension",
        "cornerId": "front_left",
        "dataClassification": "demonstration",
        "geometrySource": "synthetic_demo",
        "sourceLabel": "synthetic hardpoints",
        "hardpointsM": points,
        "cadFrame": {
            "cadAxesFromVehicle": ["+X", "+Y", "+Z"],
            "cadOriginVehicleM": {"x": 1.0, "y": 0.5, "z": 0.0},
            "anchorsCadMm": {
                "wheel_center": {"x": 200, "y": 200, "z": 250},
                "uca_outboard": {"x": 0, "y": 150, "z": 450},
                "lca_outboard": {"x": 0, "y": 150, "z": 200},
            },
            "anchorToleranceMm": 0.5,
        },
    }


def test_declared_mm_transform_preserves_units_and_identity() -> None:
    transfer = StudioTransfer.model_validate(payload())
    evidence = transfer_evidence(transfer)
    assert evidence.hardpointsCadMm["wheel_center"].components() == pytest.approx((200, 200, 250))
    assert evidence.maxDeclaredAnchorResidualMm < 1e-12
    assert evidence.status == "DECLARED_ANCHORS_MATCHED_NOT_CAD_VERIFIED"


def test_proper_90_degree_rotation_is_not_mirror() -> None:
    frame = CadFrameDeclaration.model_validate(
        {
            "cadAxesFromVehicle": ["+Y", "-X", "+Z"],
            "cadOriginVehicleM": {"x": 0, "y": 0, "z": 0},
            "anchorsCadMm": {
                "a": {"x": 0, "y": 0, "z": 0},
                "b": {"x": 0, "y": 0, "z": 0},
                "c": {"x": 0, "y": 0, "z": 0},
            },
            "anchorToleranceMm": 1,
        }
    )
    assert frame.to_cad_mm(frame.cadOriginVehicleM).components() == (0, 0, 0)
    assert frame.to_cad_mm(type(frame.cadOriginVehicleM)(x=1, y=2, z=3)).components() == (
        2000,
        -1000,
        3000,
    )


@pytest.mark.parametrize("axes", [["+X", "+Y", "-Z"], ["+X", "+X", "+Z"]])
def test_mirror_and_duplicate_axes_rejected(axes: list[str]) -> None:
    data = payload()
    frame = data["cadFrame"]
    assert isinstance(frame, dict)
    frame["cadAxesFromVehicle"] = axes
    with pytest.raises(ValidationError):
        StudioTransfer.model_validate(data)


def test_anchor_disagreement_or_missing_hardpoint_rejected() -> None:
    data = payload()
    frame = data["cadFrame"]
    assert isinstance(frame, dict)
    anchors = frame["anchorsCadMm"]
    assert isinstance(anchors, dict)
    anchors["wheel_center"] = {"x": 210, "y": 200, "z": 250}
    with pytest.raises(ValidationError, match="anchor coordinates"):
        StudioTransfer.model_validate(data)
    data = payload()
    points = data["hardpointsM"]
    assert isinstance(points, dict)
    points.pop("tie_rod_inboard")
    with pytest.raises(ValidationError, match="nine corner hardpoints"):
        StudioTransfer.model_validate(data)


def test_collinear_declared_anchors_are_insufficient_for_registration() -> None:
    data = payload()
    points = data["hardpointsM"]
    frame = data["cadFrame"]
    assert isinstance(points, dict) and isinstance(frame, dict)
    anchors = frame["anchorsCadMm"]
    assert isinstance(anchors, dict)
    points["wheel_center"] = {"x": 1.0, "y": 0.65, "z": 0.325}
    anchors["wheel_center"] = {"x": 0, "y": 150, "z": 325}
    with pytest.raises(ValidationError, match="non-collinear"):
        StudioTransfer.model_validate(data)
