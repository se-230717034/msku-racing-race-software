"""Opt-in real solve of Ansys' small AGDB example; never runs in CI or Vercel."""

from __future__ import annotations

import tempfile

from ansys.mechanical.core.examples import download_file
from msku_ansys_bridge.adapter import PyMechanicalLauncher
from msku_ansys_bridge.analysis import StaticAnalysisRequest, run_static_structural
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.discovery import discover_windows_installations


def main() -> None:
    sample = download_file(
        "example_01_geometry.agdb", "pymechanical", "00_basic", destination=tempfile.gettempdir()
    )
    settings = BridgeSettings.from_environment()
    discovery = discover_windows_installations(explicit_executable=settings.mechanical_executable)
    if discovery.selected is None:
        raise RuntimeError("No local Mechanical installation found")
    client = PyMechanicalLauncher().launch(
        installation=discovery.selected,
        host="127.0.0.1",
        port=settings.mechanical_port,
        timeout_seconds=settings.launch_timeout_seconds,
    )
    try:
        request = StaticAnalysisRequest(
            geometryPath=sample,
            fixedNamedSelection="NS_Fixed",
            forceNamedSelection="NS_Face_1",
            forceAxis="X",
            forceN=1000.0,
            meshSizeMm=500.0,
        )
        result = run_static_structural(
            client, request, lambda stage, message: print(stage + ": " + message, flush=True)
        )
        print(result.model_dump_json(indent=2), flush=True)
    finally:
        client.exit(force=True)


if __name__ == "__main__":
    main()
