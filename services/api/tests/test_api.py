from copy import deepcopy

import pytest
from httpx import ASGITransport, AsyncClient
from msku_api.main import app
from msku_api.models import EngineeringOptimizationRequest
from msku_api.optimization_adapter import build_optimization_adapter


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def api_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


def demo_project() -> dict[str, object]:
    points = [
        ("uca_front_inboard", "UCA front inboard", "upper_wishbone", (0.18, 0.31, 0.46)),
        ("uca_rear_inboard", "UCA rear inboard", "upper_wishbone", (-0.16, 0.30, 0.45)),
        ("uca_outboard", "UCA outboard", "upper_wishbone", (0.01, 0.64, 0.40)),
        ("lca_front_inboard", "LCA front inboard", "lower_wishbone", (0.22, 0.27, 0.19)),
        ("lca_rear_inboard", "LCA rear inboard", "lower_wishbone", (-0.19, 0.26, 0.18)),
        ("lca_outboard", "LCA outboard", "lower_wishbone", (0.0, 0.68, 0.17)),
        ("tie_rod_inboard", "Tie rod inboard", "steering", (-0.12, 0.29, 0.25)),
        ("tie_rod_outboard", "Tie rod outboard", "steering", (-0.09, 0.67, 0.26)),
        ("wheel_center", "Wheel centre", "wheel", (0.0, 0.72, 0.285)),
    ]
    return {
        "schemaVersion": "1.0.0",
        "projectId": "test-project",
        "name": "Test demo",
        "description": "Synthetic test data",
        "createdAt": "2026-10-15T00:00:00Z",
        "updatedAt": "2026-10-15T00:00:00Z",
        "dataClassification": "demonstration",
        "modelStatus": "unvalidated",
        "units": {"length": "m", "angle": "rad"},
        "coordinateSystem": {
            "handedness": "right",
            "xAxis": "forward",
            "yAxis": "left",
            "zAxis": "up",
        },
        "suspension": {
            "type": "double_wishbone",
            "corner": "front_left",
            "hardpoints": [
                {
                    "id": point_id,
                    "label": label,
                    "group": group,
                    "position": {"x": xyz[0], "y": xyz[1], "z": xyz[2]},
                }
                for point_id, label, group, xyz in points
            ],
            "wheel": {"radius": 0.2286, "width": 0.18},
        },
    }


def phase_six_project() -> dict[str, object]:
    project = demo_project()
    suspension = project["suspension"]
    assert isinstance(suspension, dict)
    corners: dict[str, object] = {}
    for corner_id in ("front_left", "front_right", "rear_left", "rear_right"):
        corner_suspension = deepcopy(suspension)
        corner_suspension["corner"] = corner_id
        if corner_id.endswith("right"):
            for point in corner_suspension["hardpoints"]:
                point["position"]["y"] *= -1
        corners[corner_id] = {
            "id": corner_id,
            "label": corner_id.replace("_", " "),
            "geometrySource": (
                "independent" if corner_id.endswith("left") else "mirrored_assumption"
            ),
            **(
                {"derivedFrom": corner_id.replace("right", "left")}
                if corner_id.endswith("right")
                else {}
            ),
            "provenanceNote": "Synthetic API contract fixture; not vehicle data.",
            "suspension": corner_suspension,
        }
    project.update({
        "schemaVersion": "2.0.0",
        "activeCornerId": "front_left",
        "vehicle": {
            "wheelbaseM": 1.6,
            "frontTrackM": 1.44,
            "rearTrackM": 1.4,
            "cgPositionM": {"x": 0.0, "y": 0.0, "z": 0.29},
            "massProperties": {
                "totalMassKg": 324.0,
                "sprungMassKg": 276.0,
                "rollInertiaKgM2": 80.0,
                "pitchInertiaKgM2": 120.0,
                "yawInertiaKgM2": 150.0,
                "provenanceNote": "Synthetic API fixture.",
            },
            "corners": corners,
        },
        "provenance": {"sourceLabel": "Synthetic Phase 6 API fixture"},
        "validation": {
            "numerical": "PARTIALLY_VERIFIED",
            "reference": "PARTIALLY_BENCHMARKED",
            "physical": "UNVALIDATED_PHYSICALLY",
            "engineeringApproval": "NOT_APPROVED",
            "evidence": [],
        },
    })
    return project


@pytest.mark.anyio
async def test_health() -> None:
    async with api_client() as client:
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


@pytest.mark.anyio
async def test_local_development_origin_is_allowed() -> None:
    async with api_client() as client:
        response = await client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


@pytest.mark.anyio
async def test_valid_demo_project() -> None:
    async with api_client() as client:
        response = await client.post("/api/v1/projects/validate", json=demo_project())
        assert response.status_code == 200
        assert response.json() == {
            "valid": True,
            "schemaVersion": "1.0.0",
            "units": {"length": "m", "angle": "rad"},
            "diagnostics": [],
        }


@pytest.mark.anyio
async def test_phase_six_four_corner_project_is_accepted() -> None:
    async with api_client() as client:
        response = await client.post("/api/v1/projects/validate", json=phase_six_project())
        assert response.status_code == 200
        assert response.json()["valid"] is True


@pytest.mark.anyio
async def test_phase_six_project_rejects_missing_or_inconsistent_corner() -> None:
    project = phase_six_project()
    del project["vehicle"]["corners"]["rear_right"]
    async with api_client() as client:
        response = await client.post("/api/v1/projects/validate", json=project)
        assert response.status_code == 422


@pytest.mark.anyio
async def test_invalid_geometry_returns_diagnostic() -> None:
    project = demo_project()
    suspension = project["suspension"]
    assert isinstance(suspension, dict)
    hardpoints = suspension["hardpoints"]
    assert isinstance(hardpoints, list)
    upper = next(point for point in hardpoints if point["id"] == "uca_outboard")
    upper["position"]["z"] = 0.1
    async with api_client() as client:
        response = await client.post("/api/v1/projects/validate", json=project)
        assert response.status_code == 200
        assert response.json()["valid"] is False
        assert "UPRIGHT_ORDER" in {item["code"] for item in response.json()["diagnostics"]}


@pytest.mark.anyio
async def test_unknown_schema_version_is_rejected() -> None:
    project = demo_project()
    project["schemaVersion"] = "99.0.0"
    async with api_client() as client:
        response = await client.post("/api/v1/projects/validate", json=project)
        assert response.status_code == 422


@pytest.mark.anyio
async def test_kinematics_sweep_returns_converged_states_and_diagnostics() -> None:
    request = {
        "project": demo_project(),
        "sweep": {"startTravelM": -0.03, "endTravelM": 0.03, "steps": 13},
        "solver": {"residualToleranceM": 1.0e-8, "maxFunctionEvaluations": 500},
    }
    async with api_client() as client:
        response = await client.post("/api/v1/kinematics/sweep", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["modelStatus"] == "unvalidated"
        assert payload["allConverged"] is True
        assert payload["validationStatus"] == {
            "numerical": "VERIFIED_NUMERICALLY",
            "reference": "REFERENCE_BENCHMARKED",
            "physical": "UNVALIDATED_PHYSICALLY",
            "engineeringApproval": "NOT_APPROVED",
        }
        assert payload["solver"]["version"] == "2.5.0"
        assert payload["solver"]["maximumTravelStepM"] == 0.025
        assert len(payload["inputProvenance"]["projectInputSha256"]) == 64
        assert "PHYSICAL_VALIDATION_EVIDENCE_NOT_ATTACHED" in payload["warnings"]
        assert len(payload["states"]) == 13
        assert all(
            state["calculationStatus"] == "VERIFIED_NUMERICALLY" for state in payload["states"]
        )
        assert all(state["diagnostics"]["converged"] for state in payload["states"])
        assert all(state["diagnostics"]["residualsAccepted"] for state in payload["states"])
        assert all(state["diagnostics"]["jacobianAccepted"] for state in payload["states"])
        assert all(state["diagnostics"]["continuityAccepted"] for state in payload["states"])
        assert all(
            state["diagnostics"]["maxAbsResidualM"] <= payload["residualToleranceM"]
            for state in payload["states"]
        )
        assert all(state["pose"] is not None for state in payload["states"])


@pytest.mark.anyio
async def test_kinematics_rejects_invalid_static_geometry() -> None:
    project = demo_project()
    suspension = project["suspension"]
    assert isinstance(suspension, dict)
    hardpoints = suspension["hardpoints"]
    assert isinstance(hardpoints, list)
    upper = next(point for point in hardpoints if point["id"] == "uca_outboard")
    upper["position"]["z"] = 0.1
    async with api_client() as client:
        response = await client.post(
            "/api/v1/kinematics/sweep",
            json={"project": project, "sweep": {"steps": 5}},
        )
        assert response.status_code == 422
        assert response.json()["detail"][0]["code"] == "UPRIGHT_ORDER"


@pytest.mark.anyio
async def test_kinematics_serializes_non_convergence_without_fake_pose() -> None:
    project = demo_project()
    suspension = project["suspension"]
    assert isinstance(suspension, dict)
    hardpoints = suspension["hardpoints"]
    assert isinstance(hardpoints, list)
    by_id = {point["id"]: point for point in hardpoints}
    by_id["tie_rod_inboard"]["position"] = dict(by_id["uca_front_inboard"]["position"])
    by_id["tie_rod_outboard"]["position"] = dict(by_id["uca_outboard"]["position"])
    request = {
        "project": project,
        "sweep": {"startTravelM": -0.01, "endTravelM": 0.01, "steps": 5},
    }
    async with api_client() as client:
        response = await client.post("/api/v1/kinematics/sweep", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["allConverged"] is False
        assert payload["validationStatus"]["numerical"] == "FAILED"
        failed = [state for state in payload["states"] if not state["diagnostics"]["converged"]]
        assert failed
        assert all(state["pose"] is None and state["metrics"] is None for state in failed)
        assert all(state["calculationStatus"] == "FAILED" for state in failed)
        assert any("NON_CONVERGENCE" in state["warnings"] for state in failed)


@pytest.mark.anyio
async def test_kinematics_rejects_unverified_coarse_travel_steps() -> None:
    request = {
        "project": demo_project(),
        "sweep": {"startTravelM": -0.05, "endTravelM": 0.05, "steps": 3},
    }
    async with api_client() as client:
        response = await client.post("/api/v1/kinematics/sweep", json=request)
        assert response.status_code == 422
        assert "verified maximum" in response.json()["detail"]


@pytest.mark.anyio
async def test_declared_project_status_cannot_promote_physical_validation() -> None:
    project = demo_project()
    project["modelStatus"] = "experimentally_validated"
    request = {
        "project": project,
        "sweep": {"startTravelM": -0.01, "endTravelM": 0.01, "steps": 5},
    }
    async with api_client() as client:
        response = await client.post("/api/v1/kinematics/sweep", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["inputProvenance"]["declaredModelStatus"] == "experimentally_validated"
        assert payload["validationStatus"]["physical"] == "UNVALIDATED_PHYSICALLY"
        assert payload["validationStatus"]["engineeringApproval"] == "NOT_APPROVED"


@pytest.mark.anyio
async def test_zero_wrench_upright_equilibrium_is_verified_with_five_members() -> None:
    request = {
        "project": demo_project(),
        "travelM": 0.0,
        "externalWrench": {
            "forceN": {"x": 0.0, "y": 0.0, "z": 0.0},
            "momentNm": {"x": 0.0, "y": 0.0, "z": 0.0},
            "applicationPointM": {"x": 0.0, "y": 0.72, "z": 0.285},
        },
    }
    async with api_client() as client:
        response = await client.post("/api/v1/quasi-static/upright-equilibrium", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
        assert payload["validationStatus"]["physical"] == "UNVALIDATED_PHYSICALLY"
        assert payload["validationStatus"]["engineeringApproval"] == "NOT_APPROVED"
        assert payload["diagnostics"]["matrixColumns"] == 5
        assert payload["diagnostics"]["matrixRank"] == 5
        assert len(payload["memberForces"]) == 5
        assert all(abs(item["axialForceN"]) < 1.0e-9 for item in payload["memberForces"])


@pytest.mark.anyio
async def test_missing_actuation_path_suppresses_incompatible_vertical_wrench() -> None:
    request = {
        "project": demo_project(),
        "travelM": 0.0,
        "externalWrench": {
            "forceN": {"x": 0.0, "y": 0.0, "z": -1000.0},
            "momentNm": {"x": 0.0, "y": 0.0, "z": 0.0},
            "applicationPointM": {"x": 0.0, "y": 0.72, "z": 0.285},
        },
    }
    async with api_client() as client:
        response = await client.post("/api/v1/quasi-static/upright-equilibrium", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["calculationStatus"] == "NOT_COMPUTABLE"
        assert payload["memberForces"] == []
        assert "ACTUATION_FORCE_PATH_MAY_BE_MISSING" in payload["warnings"]


@pytest.mark.anyio
async def test_explicit_sixth_force_path_balances_vertical_wrench() -> None:
    request = {
        "project": demo_project(),
        "travelM": 0.0,
        "externalWrench": {
            "forceN": {"x": 0.0, "y": 0.0, "z": -1000.0},
            "momentNm": {"x": 0.0, "y": 0.0, "z": 0.0},
            "applicationPointM": {"x": 0.0, "y": 0.72, "z": 0.285},
        },
        "additionalMember": {
            "id": "explicit_actuation_link",
            "chassisPointM": {"x": 0.0, "y": 0.72, "z": 1.285},
            "uprightPointM": {"x": 0.0, "y": 0.72, "z": 0.285},
        },
    }
    async with api_client() as client:
        response = await client.post("/api/v1/quasi-static/upright-equilibrium", json=request)
        assert response.status_code == 200
        payload = response.json()
        assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
        by_id = {item["id"]: item for item in payload["memberForces"]}
        assert by_id["explicit_actuation_link"]["axialForceN"] == pytest.approx(1000.0)
        assert payload["diagnostics"]["forceResidualNormN"] < 1.0e-6
        assert payload["diagnostics"]["momentResidualNormNm"] < 1.0e-6


@pytest.mark.anyio
async def test_load_transfer_api_reference_case_and_missing_lateral_split() -> None:
    base = {
        "massKg": 300.0,
        "wheelbaseM": 2.0,
        "cgFromFrontAxleM": 0.8,
        "cgHeightM": 0.3,
        "frontTrackM": 1.2,
        "rearTrackM": 1.2,
        "longitudinalAccelerationMps2": 2.0,
    }
    async with api_client() as client:
        reference = await client.post("/api/v1/quasi-static/load-transfer", json=base)
        assert reference.status_code == 200
        payload = reference.json()
        assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
        assert payload["longitudinalTransferN"] == pytest.approx(90.0)
        assert payload["wheelLoads"] is not None

        unsupported = await client.post(
            "/api/v1/quasi-static/load-transfer",
            json={**base, "lateralAccelerationMps2": 5.0},
        )
        assert unsupported.status_code == 200
        unsupported_payload = unsupported.json()
        assert unsupported_payload["calculationStatus"] == "NOT_COMPUTABLE"
        assert unsupported_payload["wheelLoads"] is None


@pytest.mark.anyio
async def test_actuation_series_and_velocity_explicit_damper_api() -> None:
    async with api_client() as client:
        actuation = await client.post(
            "/api/v1/quasi-static/actuation-series",
            json={
                "wheelTravelM": [-0.01, 0.0, 0.01],
                "springLengthM": [0.205, 0.2, 0.195],
                "referenceSpringLengthM": 0.2,
                "springRateNPerM": 10000.0,
                "preloadN": 100.0,
            },
        )
        assert actuation.status_code == 200
        actuation_payload = actuation.json()
        assert actuation_payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
        assert [item["motionRatio"] for item in actuation_payload["samples"]] == pytest.approx(
            [0.5, 0.5, 0.5]
        )

        missing = await client.post(
            "/api/v1/quasi-static/damper-force",
            json={"compressionCoefficientNsPerM": 1000.0, "reboundCoefficientNsPerM": 1500.0},
        )
        assert missing.status_code == 200
        assert missing.json()["calculationStatus"] == "NOT_COMPUTABLE"
        assert missing.json()["forceN"] is None


@pytest.mark.anyio
async def test_coilover_series_api_combines_spring_damper_and_motion_ratio() -> None:
    async with api_client() as client:
        response = await client.post(
            "/api/v1/quasi-static/coilover-series",
            json={
                "wheelTravelM": [-0.01, 0.0, 0.01],
                "wheelVelocityMps": [0.4, 0.4, 0.4],
                "coiloverLengthM": [0.205, 0.2, 0.195],
                "referenceCoiloverLengthM": 0.2,
                "springRateNPerM": 10000.0,
                "preloadN": 100.0,
                "compressionCoefficientNsPerM": 1000.0,
                "reboundCoefficientNsPerM": 1500.0,
                "minimumCoiloverLengthM": 0.18,
                "maximumCoiloverLengthM": 0.22,
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
        assert payload["solverVersion"] == "3.1.0"
        assert payload["validationStatus"]["physical"] == "UNVALIDATED_PHYSICALLY"
        assert payload["samples"][1]["motionRatio"] == pytest.approx(0.5)
        assert payload["samples"][1]["damperForceN"] == pytest.approx(-200.0)
        assert payload["samples"][1]["totalAxialForceN"] == pytest.approx(300.0)
        assert payload["samples"][1]["wheelForceN"] == pytest.approx(-150.0)


def quarter_car_request() -> dict[str, object]:
    return {
        "dataClassification": "demonstration",
        "sourceLabel": "Synthetic Phase 4 API regression fixture",
        "parameters": {
            "sprungMassKg": 75.0,
            "unsprungMassKg": 12.0,
            "suspensionStiffnessNPerM": 30000.0,
            "suspensionDampingNsPerM": 1800.0,
            "tireStiffnessNPerM": 180000.0,
            "tireDampingNsPerM": 0.0,
            "staticTireLoadN": 1000.0,
        },
        "road": {
            "kind": "smooth_bump",
            "amplitudeM": 0.01,
            "startTimeS": 0.2,
            "durationS": 0.15,
            "frequencyHz": 1.0,
            "sampleTimesS": [],
            "sampleDisplacementsM": [],
        },
        "initialState": {
            "sprungDisplacementM": 0.0,
            "sprungVelocityMps": 0.0,
            "unsprungDisplacementM": 0.0,
            "unsprungVelocityMps": 0.0,
        },
        "settings": {
            "durationS": 1.5,
            "outputSamples": 301,
            "relativeTolerance": 1.0e-8,
            "absoluteTolerance": 1.0e-10,
            "maximumStepS": 0.002,
            "method": "DOP853",
        },
    }


def parameter_manifest() -> dict[str, object]:
    return {
        "schemaVersion": "1.0.0",
        "manifestId": "api-regression-manifest",
        "revision": 3,
        "vehicleId": "fs-2026",
        "configurationId": "synthetic-api-fixture",
        "configurationLabel": "Synthetic API fixture",
        "createdAt": "2026-10-16T00:00:00Z",
        "updatedAt": "2026-10-16T00:00:00Z",
        "parameters": [
            {
                "key": "quarter_car.sprung_mass",
                "value": 75.0,
                "unit": "kg",
                "measurementStatus": "SYNTHETIC",
                "source": {
                    "kind": "synthetic_assumption",
                    "label": "API regression fixture; not vehicle data",
                },
                "applicableModules": ["quarter_car"],
                "evidenceIds": ["input-declaration"],
            }
        ],
        "verification": {
            "declared": {"status": "DECLARED", "evidenceIds": ["input-declaration"]},
            "numerical": {"status": "UNVERIFIED", "evidenceIds": []},
            "reference": {"status": "NOT_BENCHMARKED", "evidenceIds": []},
            "physical": {"status": "UNVALIDATED_PHYSICALLY", "evidenceIds": []},
            "evidence": [
                {
                    "id": "input-declaration",
                    "kind": "input_declaration",
                    "title": "Synthetic fixture declaration",
                    "source": "services/api/tests/test_api.py",
                    "reviewStatus": "accepted",
                }
            ],
        },
    }


@pytest.mark.anyio
async def test_quarter_car_api_returns_calculated_samples_and_provenance() -> None:
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/quarter-car/simulate", json=quarter_car_request()
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
    assert payload["validationStatus"] == {
        "numerical": "VERIFIED_NUMERICALLY",
        "reference": "REFERENCE_BENCHMARKED",
        "physical": "UNVALIDATED_PHYSICALLY",
        "engineeringApproval": "NOT_APPROVED",
    }
    assert payload["solverVersion"] == "4.0.0"
    assert len(payload["inputProvenance"]["inputSha256"]) == 64
    assert len(payload["naturalFrequenciesHz"]) == 2
    assert len(payload["samples"]) == 301
    assert payload["samples"][0]["timeS"] == 0.0
    assert payload["samples"][-1]["timeS"] == pytest.approx(1.5)
    assert max(item["roadDisplacementM"] for item in payload["samples"]) == pytest.approx(
        0.01, abs=2.0e-5
    )
    assert payload["diagnostics"]["solverSuccess"] is True
    assert payload["diagnostics"]["contactAccepted"] is True
    assert payload["parameterManifest"] is None
    assert "VEHICLE_PARAMETER_MANIFEST_NOT_PROVIDED" in payload["warnings"]
    assert payload["verificationAxes"]["declared"]["status"] == "DECLARED"
    assert payload["verificationAxes"]["numerical"]["status"] == "VERIFIED_NUMERICALLY"
    assert payload["verificationAxes"]["reference"]["status"] == "REFERENCE_BENCHMARKED"
    assert payload["verificationAxes"]["physical"] == {
        "status": "UNVALIDATED_PHYSICALLY",
        "evidenceIds": [],
    }


@pytest.mark.anyio
async def test_parameter_manifest_is_traceable_without_physical_promotion() -> None:
    request = quarter_car_request()
    request["parameterManifest"] = parameter_manifest()
    async with api_client() as client:
        response = await client.post("/api/v1/dynamics/quarter-car/simulate", json=request)
    assert response.status_code == 200
    payload = response.json()
    assert payload["parameterManifest"]["manifestId"] == "api-regression-manifest"
    assert payload["parameterManifest"]["revision"] == 3
    assert len(payload["parameterManifest"]["manifestSha256"]) == 64
    assert "VEHICLE_PARAMETER_MANIFEST_CONTAINS_SYNTHETIC_ASSUMPTIONS" in payload["warnings"]
    assert payload["verificationAxes"]["physical"]["status"] == "UNVALIDATED_PHYSICALLY"
    assert not payload["verificationAxes"]["physical"]["evidenceIds"]


@pytest.mark.anyio
async def test_synthetic_manifest_parameter_cannot_claim_measurement() -> None:
    request = quarter_car_request()
    manifest = parameter_manifest()
    manifest["parameters"][0]["measurementStatus"] = "MEASURED"  # type: ignore[index]
    request["parameterManifest"] = manifest
    async with api_client() as client:
        response = await client.post("/api/v1/dynamics/quarter-car/simulate", json=request)
    assert response.status_code == 422


@pytest.mark.anyio
async def test_quarter_car_api_suppresses_samples_after_contact_loss() -> None:
    request = quarter_car_request()
    request["parameters"] = {
        **request["parameters"],  # type: ignore[dict-item]
        "staticTireLoadN": 100.0,
    }
    request["road"] = {
        "kind": "sine",
        "amplitudeM": 0.0,
        "startTimeS": 0.0,
        "durationS": 0.1,
        "frequencyHz": 1.0,
        "sampleTimesS": [],
        "sampleDisplacementsM": [],
    }
    request["initialState"] = {
        "sprungDisplacementM": 0.0,
        "sprungVelocityMps": 0.0,
        "unsprungDisplacementM": 0.01,
        "unsprungVelocityMps": 0.0,
    }
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/quarter-car/simulate", json=request
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "FAILED"
    assert payload["samples"] == []
    assert payload["diagnostics"]["contactAccepted"] is False
    assert "TIRE_CONTACT_LOSS_UNSUPPORTED" in payload["warnings"]


@pytest.mark.anyio
async def test_quarter_car_api_rejects_invalid_sampled_road_as_failed_result() -> None:
    request = quarter_car_request()
    request["road"] = {
        "kind": "sampled",
        "amplitudeM": 0.0,
        "startTimeS": 0.0,
        "durationS": 0.1,
        "frequencyHz": 1.0,
        "sampleTimesS": [0.0, 0.2, 0.1],
        "sampleDisplacementsM": [0.0, 0.01, 0.0],
    }
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/quarter-car/simulate", json=request
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "FAILED"
    assert payload["samples"] == []
    assert payload["warnings"] == ["INVALID_DYNAMICS_INPUT"]


def full_car_request() -> dict[str, object]:
    corner = {
        "unsprungMassKg": 12.0,
        "suspensionStiffnessNPerM": 30000.0,
        "suspensionDampingNsPerM": 1800.0,
        "tireStiffnessNPerM": 180000.0,
        "tireDampingNsPerM": 0.0,
        "staticTireLoadN": 1000.0,
    }
    road = {
        "kind": "smooth_bump",
        "amplitudeM": 0.005,
        "startTimeS": 0.2,
        "durationS": 0.15,
        "frequencyHz": 1.0,
        "sampleTimesS": [],
        "sampleDisplacementsM": [],
    }
    return {
        "dataClassification": "demonstration",
        "sourceLabel": "Synthetic Phase 5 full-car API regression fixture",
        "parameters": {
            "sprungMassKg": 300.0,
            "pitchInertiaKgM2": 120.0,
            "rollInertiaKgM2": 80.0,
            "corners": [
                {**corner, "xPositionM": 0.8, "yPositionM": 0.6},
                {**corner, "xPositionM": 0.8, "yPositionM": -0.6},
                {**corner, "xPositionM": -0.8, "yPositionM": 0.6},
                {**corner, "xPositionM": -0.8, "yPositionM": -0.6},
            ],
        },
        "roadProfiles": [road, road, road, road],
        "initialState": {
            "bodyHeaveM": 0.0,
            "bodyHeaveVelocityMps": 0.0,
            "pitchRad": 0.0,
            "pitchRateRadps": 0.0,
            "rollRad": 0.0,
            "rollRateRadps": 0.0,
            "unsprungDisplacementsM": [0.0, 0.0, 0.0, 0.0],
            "unsprungVelocitiesMps": [0.0, 0.0, 0.0, 0.0],
        },
        "settings": {
            "durationS": 1.0,
            "outputSamples": 201,
            "relativeTolerance": 1.0e-8,
            "absoluteTolerance": 1.0e-10,
            "maximumStepS": 0.002,
            "method": "DOP853",
        },
    }


@pytest.mark.anyio
async def test_full_car_api_returns_symmetric_calculated_response() -> None:
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/full-car/simulate", json=full_car_request()
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
    assert payload["validationStatus"]["reference"] == "REFERENCE_BENCHMARKED"
    assert payload["validationStatus"]["physical"] == "UNVALIDATED_PHYSICALLY"
    assert payload["solverVersion"] == "5.0.0"
    assert len(payload["inputProvenance"]["inputSha256"]) == 64
    assert payload["cornerOrder"] == [
        "front_left", "front_right", "rear_left", "rear_right"
    ]
    assert len(payload["naturalFrequenciesHz"]) == 7
    assert len(payload["samples"]) == 201
    assert max(abs(item["pitchRad"]) for item in payload["samples"]) < 1.0e-10
    assert max(abs(item["rollRad"]) for item in payload["samples"]) < 1.0e-10
    assert payload["diagnostics"]["contactAccepted"] is True


@pytest.mark.anyio
async def test_full_car_api_suppresses_samples_after_one_corner_contact_loss() -> None:
    request = full_car_request()
    parameters = request["parameters"]
    assert isinstance(parameters, dict)
    corners = parameters["corners"]
    assert isinstance(corners, list)
    corners[0] = {**corners[0], "staticTireLoadN": 50.0}
    request["roadProfiles"] = [
        {
            "kind": "sine", "amplitudeM": 0.0, "startTimeS": 0.0,
            "durationS": 0.1, "frequencyHz": 1.0,
            "sampleTimesS": [], "sampleDisplacementsM": [],
        }
    ] * 4
    initial = request["initialState"]
    assert isinstance(initial, dict)
    initial["unsprungDisplacementsM"] = [0.01, 0.0, 0.0, 0.0]
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/full-car/simulate", json=request
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "FAILED"
    assert payload["samples"] == []
    assert payload["diagnostics"]["contactAccepted"] is False
    assert payload["diagnostics"]["contactLossCorner"] == "front_left"


def bicycle_request() -> dict[str, object]:
    return {
        "dataClassification": "demonstration",
        "sourceLabel": "Synthetic Phase 5 bicycle API regression fixture",
        "parameters": {
            "massKg": 300.0,
            "yawInertiaKgM2": 150.0,
            "cgToFrontAxleM": 0.8,
            "cgToRearAxleM": 0.8,
            "frontCorneringStiffnessNPerRad": 50000.0,
            "rearCorneringStiffnessNPerRad": 50000.0,
            "speedMps": 15.0,
        },
        "steering": {
            "kind": "smooth_step",
            "amplitudeRad": 0.02,
            "startTimeS": 0.2,
            "riseTimeS": 0.1,
            "frequencyHz": 1.0,
            "sampleTimesS": [],
            "sampleAnglesRad": [],
        },
        "initialState": {"lateralVelocityMps": 0.0, "yawRateRadps": 0.0},
        "domainLimits": {
            "maximumAbsSteeringRad": 0.15,
            "maximumAbsSideslipRad": 0.15,
            "maximumAbsTireSlipRad": 0.15,
        },
        "settings": {
            "durationS": 1.5,
            "outputSamples": 301,
            "relativeTolerance": 1.0e-8,
            "absoluteTolerance": 1.0e-10,
            "maximumStepS": 0.002,
            "method": "DOP853",
        },
    }


@pytest.mark.anyio
async def test_bicycle_api_returns_stable_traceable_response() -> None:
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/bicycle/simulate", json=bicycle_request()
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
    assert payload["validationStatus"]["reference"] == "REFERENCE_BENCHMARKED"
    assert payload["validationStatus"]["physical"] == "UNVALIDATED_PHYSICALLY"
    assert payload["solverVersion"] == "5.0.0"
    assert len(payload["inputProvenance"]["inputSha256"]) == 64
    assert len(payload["samples"]) == 301
    assert payload["samples"][-1]["yawRateRadps"] > 0.0
    assert payload["diagnostics"]["stable"] is True
    assert payload["diagnostics"]["domainAccepted"] is True


@pytest.mark.anyio
async def test_bicycle_api_suppresses_out_of_domain_result() -> None:
    request = bicycle_request()
    steering = request["steering"]
    assert isinstance(steering, dict)
    steering["amplitudeRad"] = 0.2
    async with api_client() as client:
        response = await client.post(
            "/api/v1/dynamics/bicycle/simulate", json=request
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "FAILED"
    assert payload["samples"] == []
    assert payload["diagnostics"]["domainAccepted"] is False
    assert "LINEAR_BICYCLE_DOMAIN_EXCEEDED" in payload["warnings"]


def bicycle_optimization_request() -> dict[str, object]:
    model = bicycle_request()
    steering = model["steering"]
    assert isinstance(steering, dict)
    steering.update({"startTimeS": 0.05, "riseTimeS": 0.05, "amplitudeRad": 0.01})
    model["settings"] = {
        "durationS": 0.5,
        "outputSamples": 51,
        "relativeTolerance": 1.0e-7,
        "absoluteTolerance": 1.0e-9,
        "maximumStepS": 0.01,
        "method": "DOP853",
    }
    return {
        "model": "bicycle",
        "designVariables": [
            {
                "path": "parameters.frontCorneringStiffnessNPerRad",
                "lowerBound": 40000.0,
                "upperBound": 60000.0,
            }
        ],
        "objectives": [
            {
                "id": "final_yaw_rate_radps",
                "goal": "target",
                "targetValue": 0.09,
                "weight": 1.0,
                "normalization": 0.1,
            }
        ],
        "constraints": {
            "minimumLinkLengthM": 0.001,
            "maximumAbsSuspensionTravelM": None,
            "requireWheelContact": False,
            "requireStableHandling": True,
        },
        "settings": {
            "seed": 2307,
            "maximumGenerations": 50,
            "populationMultiplier": 6,
            "convergenceTolerance": 1.0e-6,
            "paretoPoints": 0,
            "sensitivityStepFraction": 1.0e-4,
        },
        "project": None,
        "kinematicsSweep": None,
        "kinematicsSolver": None,
        "quarterCar": None,
        "fullCar": None,
        "bicycle": model,
    }


@pytest.mark.anyio
async def test_optimization_api_returns_traceable_bicycle_candidate() -> None:
    request = bicycle_optimization_request()
    async with api_client() as client:
        response = await client.post("/api/v1/optimization/run", json=request)
    assert response.status_code == 200
    payload = response.json()
    assert payload["calculationStatus"] == "VERIFIED_NUMERICALLY"
    assert payload["model"] == "bicycle"
    assert payload["validationStatus"]["physical"] == "UNVALIDATED_PHYSICALLY"
    assert payload["validationStatus"]["engineeringApproval"] == "NOT_APPROVED"
    assert payload["baseline"] is not None
    assert payload["optimized"] is not None
    assert payload["optimized"]["weightedObjective"] <= payload["baseline"]["weightedObjective"]
    value = payload["optimized"]["variableValues"][
        "parameters.frontCorneringStiffnessNPerRad"
    ]
    assert 40000.0 <= value <= 60000.0
    assert payload["diagnostics"]["seed"] == 2307
    assert payload["diagnostics"]["rejectedEvaluations"] == 0
    assert len(payload["provenance"]["inputSha256"]) == 64
    assert payload["sensitivities"][0]["derivative"] is not None


@pytest.mark.anyio
async def test_optimization_api_rejects_unverified_objective() -> None:
    request = bicycle_optimization_request()
    request["objectives"] = [
        {
            "id": "invented_tire_temperature",
            "goal": "minimize",
            "targetValue": None,
            "weight": 1.0,
            "normalization": 1.0,
        }
    ]
    async with api_client() as client:
        response = await client.post("/api/v1/optimization/run", json=request)
    assert response.status_code == 422
    assert "Unsupported or unverified" in response.json()["detail"]


def test_kinematics_optimization_adapter_enforces_geometry_and_link_constraint() -> None:
    request = EngineeringOptimizationRequest.model_validate(
        {
            "model": "kinematics",
            "designVariables": [
                {
                    "path": "hardpoints.tie_rod_inboard.y",
                    "lowerBound": 0.2,
                    "upperBound": 0.7,
                },
                {
                    "path": "hardpoints.tie_rod_inboard.x",
                    "lowerBound": -0.15,
                    "upperBound": -0.05,
                },
                {
                    "path": "hardpoints.tie_rod_inboard.z",
                    "lowerBound": 0.2,
                    "upperBound": 0.3,
                },
            ],
            "objectives": [
                {
                    "id": "bump_steer_rms_rad",
                    "goal": "minimize",
                    "weight": 1.0,
                    "normalization": 0.01,
                }
            ],
            "constraints": {
                "minimumLinkLengthM": 0.01,
                "maximumAbsSuspensionTravelM": 0.02,
                "requireWheelContact": False,
                "requireStableHandling": False,
            },
            "settings": {
                "seed": 2307,
                "maximumGenerations": 5,
                "populationMultiplier": 4,
                "convergenceTolerance": 1.0e-4,
                "paretoPoints": 0,
                "sensitivityStepFraction": 1.0e-4,
            },
            "project": demo_project(),
            "kinematicsSweep": {
                "startTravelM": -0.01,
                "endTravelM": 0.01,
                "steps": 5,
            },
            "kinematicsSolver": {
                "residualToleranceM": 1.0e-8,
                "maxFunctionEvaluations": 500,
            },
        }
    )
    variables, evaluator, objectives = build_optimization_adapter(request)
    assert objectives == (
        "bump_steer_rms_rad",
        "camber_variation_rms_rad",
        "roll_center_migration_rms_m",
        "maximum_abs_track_change_m",
    )
    baseline_values = {variable.name: variable.baseline for variable in variables}
    baseline = evaluator(baseline_values)
    assert baseline.feasible
    assert baseline.metrics["bump_steer_rms_rad"] > 0.0

    coincident_tie_rod = evaluator(
        {
            "hardpoints.tie_rod_inboard.y": 0.67,
            "hardpoints.tie_rod_inboard.x": -0.09,
            "hardpoints.tie_rod_inboard.z": 0.26,
        }
    )
    assert not coincident_tie_rod.feasible
    assert "MINIMUM_LINK_LENGTH_VIOLATION" in coincident_tie_rod.violations


@pytest.mark.parametrize(
    ("model", "path", "lower", "upper", "objective", "payload_key", "payload"),
    [
        (
            "quarter_car",
            "parameters.suspensionStiffnessNPerM",
            20000.0,
            40000.0,
            "sprung_acceleration_rms_mps2",
            "quarterCar",
            quarter_car_request(),
        ),
        (
            "full_car",
            "parameters.corners.0.suspensionDampingNsPerM",
            800.0,
            3000.0,
            "body_heave_acceleration_rms_mps2",
            "fullCar",
            full_car_request(),
        ),
        (
            "bicycle",
            "parameters.frontCorneringStiffnessNPerRad",
            40000.0,
            60000.0,
            "maximum_abs_sideslip_rad",
            "bicycle",
            bicycle_request(),
        ),
    ],
)
def test_verified_dynamics_optimization_adapters_produce_real_metrics(
    model: str,
    path: str,
    lower: float,
    upper: float,
    objective: str,
    payload_key: str,
    payload: dict[str, object],
) -> None:
    request_data: dict[str, object] = {
        "model": model,
        "designVariables": [{"path": path, "lowerBound": lower, "upperBound": upper}],
        "objectives": [
            {
                "id": objective,
                "goal": "minimize",
                "targetValue": None,
                "weight": 1.0,
                "normalization": 1.0,
            }
        ],
        "constraints": {
            "minimumLinkLengthM": 0.001,
            "maximumAbsSuspensionTravelM": 0.1,
            "requireWheelContact": model != "bicycle",
            "requireStableHandling": model == "bicycle",
        },
        "settings": {
            "seed": 2307,
            "maximumGenerations": 5,
            "populationMultiplier": 4,
            "convergenceTolerance": 1.0e-4,
            "paretoPoints": 0,
            "sensitivityStepFraction": 1.0e-4,
        },
        payload_key: payload,
    }
    request = EngineeringOptimizationRequest.model_validate(request_data)
    variables, evaluator, available = build_optimization_adapter(request)
    assert objective in available
    evaluation = evaluator({variables[0].name: variables[0].baseline})
    assert evaluation.feasible
    assert objective in evaluation.metrics
    assert evaluation.metrics[objective] >= 0.0
