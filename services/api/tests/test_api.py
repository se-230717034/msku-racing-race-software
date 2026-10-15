import pytest
from httpx import ASGITransport, AsyncClient
from msku_api.main import app


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
