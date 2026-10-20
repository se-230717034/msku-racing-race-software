"""Opt-in end-to-end Phase 3 bridge smoke against a real local Mechanical process."""

from __future__ import annotations

import tempfile
import time

from ansys.mechanical.core.examples import download_file
from fastapi.testclient import TestClient
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.main import create_app


def main() -> None:
    sample = download_file(
        "example_01_geometry.agdb", "pymechanical", "00_basic", destination=tempfile.gettempdir()
    )
    token = "local-phase-three-smoke-token-000000000000"
    origin = "http://127.0.0.1:5173"
    headers = {"X-MSKU-Bridge-Token": token, "Origin": origin}
    settings = BridgeSettings(
        token=token,
        allowed_origins=(origin,),
        allow_test_client=True,
        mechanical_executable=BridgeSettings.from_environment().mechanical_executable,
    )
    with TestClient(create_app(settings)) as bridge:
        connection = bridge.post("/bridge/v1/connection/launch", headers=headers)
        connection.raise_for_status()
        if connection.json()["state"] != "VERIFIED":
            raise RuntimeError("Mechanical launch was not verified: " + connection.json()["state"])
        started = bridge.post(
            "/bridge/v1/analyses/static-structural",
            headers=headers,
            json={
                "geometryPath": sample,
                "material": "Structural Steel",
                "fixedNamedSelection": "NS_Fixed",
                "forceNamedSelection": "NS_Face_1",
                "forceAxis": "X",
                "forceN": 1000,
                "meshSizeMm": 500,
            },
        )
        started.raise_for_status()
        job_id = started.json()["jobId"]
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            response = bridge.get(
                f"/bridge/v1/analyses/static-structural/{job_id}", headers=headers
            )
            response.raise_for_status()
            job = response.json()
            print(job["state"], job["stage"], flush=True)
            if job["state"] == "FAILED":
                raise RuntimeError(job["errorCode"] + ": " + job["message"])
            if job["state"] == "SUCCEEDED":
                print(job["result"], flush=True)
                return
            time.sleep(2)
        raise TimeoutError("Mechanical solve exceeded local smoke wait window")


if __name__ == "__main__":
    main()
