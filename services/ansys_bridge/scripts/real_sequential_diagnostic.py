"""Opt-in sequential licensed session diagnostic; prints real call timings only."""

from __future__ import annotations

import json
import time
from typing import Any

from msku_ansys_bridge.adapter import PyMechanicalLauncher
from msku_ansys_bridge.analysis import StaticAnalysisRequest, run_static_structural
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.discovery import discover_windows_installations
from msku_ansys_bridge.modal import ModalAnalysisRequest, run_modal_analysis
from sample_cad import official_example_cad


class TimedClient:
    def __init__(self, client: Any) -> None:
        self.client = client

    def __getattr__(self, name: str) -> Any:
        return getattr(self.client, name)

    def clear(self) -> Any:
        return self._call("project.clear", self.client.clear)

    def run_python_script(self, script: str) -> Any:
        if "GeometryImport" in script:
            label = "geometry.import"
        elif "Solution.Solve(True)" in script:
            label = "solution.solve"
        elif "GenerateMesh()" in script:
            label = "mesh.generate"
        elif "EvaluateAllResults()" in script:
            label = "results.evaluate"
        elif "Project.SaveAs(" in script:
            label = "project.save"
        else:
            label = "script.other"
        return self._call(label, lambda: self.client.run_python_script(script))

    @staticmethod
    def _call(label: str, action: Any) -> Any:
        started = time.monotonic()
        print(json.dumps({"event": "begin", "call": label, "at": time.time()}), flush=True)
        try:
            return action()
        finally:
            print(
                json.dumps(
                    {"event": "end", "call": label, "seconds": round(time.monotonic() - started, 3)}
                ),
                flush=True,
            )


def main() -> None:
    settings = BridgeSettings.from_environment()
    discovery = discover_windows_installations(explicit_executable=settings.mechanical_executable)
    if discovery.selected is None:
        raise RuntimeError("No local Mechanical installation found")
    client = PyMechanicalLauncher().launch(
        installation=discovery.selected,
        host="127.0.0.1",
        port=settings.mechanical_port,
        timeout_seconds=settings.launch_timeout_seconds,
        start_license=settings.start_license,
    )
    timed = TimedClient(client)
    try:
        print("Product: " + str(client.get_product_info()), flush=True)
        print(
            "ReadOnlyMode: "
            + str(
                client.run_python_script("Ansys.ACT.Mechanical.MechanicalAPI.Instance.ReadOnlyMode")
            ),
            flush=True,
        )
        path = official_example_cad()
        for run in range(1, 4):
            started = time.monotonic()
            print(json.dumps({"event": "run.begin", "run": run}), flush=True)
            static = run_static_structural(
                timed,
                StaticAnalysisRequest(
                    geometryPath=path,
                    fixedNamedSelection="NS_Fixed",
                    forceNamedSelection="NS_Face_1",
                    forceAxis="X",
                    forceN=1000.0,
                    meshSizeMm=300.0,
                    meshConvergenceSizesMm=[500.0, 400.0, 300.0],
                ),
                lambda stage, message, run=run: print(
                    json.dumps({"run": run, "static": stage, "message": message}), flush=True
                ),
            )
            print(
                json.dumps(
                    {
                        "run": run,
                        "staticStatus": static.solverStatus,
                        "convergence": static.meshConvergence.status
                        if static.meshConvergence
                        else None,
                    }
                ),
                flush=True,
            )
            modal = run_modal_analysis(
                timed,
                ModalAnalysisRequest(
                    geometryPath=path,
                    fixedNamedSelection="NS_Fixed",
                    meshSizeMm=500.0,
                    modeCount=3,
                ),
                lambda stage, message, run=run: print(
                    json.dumps({"run": run, "modal": stage, "message": message}), flush=True
                ),
            )
            print(
                json.dumps(
                    {
                        "event": "run.end",
                        "run": run,
                        "seconds": round(time.monotonic() - started, 3),
                        "modalFrequenciesHz": [m.frequencyHz for m in modal.modes],
                    }
                ),
                flush=True,
            )
    finally:
        client.exit(force=True)


if __name__ == "__main__":
    main()
