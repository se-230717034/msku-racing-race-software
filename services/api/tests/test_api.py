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
