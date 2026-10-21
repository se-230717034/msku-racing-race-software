"""Opt-in real solve of Ansys' small AGDB example; never runs in CI or Vercel."""

from __future__ import annotations

import re
from pathlib import Path

from msku_ansys_bridge.adapter import PyMechanicalLauncher
from msku_ansys_bridge.analysis import StaticAnalysisRequest, run_static_structural
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.discovery import discover_windows_installations
from sample_cad import official_example_cad


def main() -> None:
    sample = official_example_cad()
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
    try:
        print("Mechanical product report: " + str(client.get_product_info()), flush=True)
        read_only = str(
            client.run_python_script(
                "Ansys.ACT.Mechanical.MechanicalAPI.Instance.ReadOnlyMode"
            )
        ).strip().casefold()
        print("Mechanical read-only: " + read_only, flush=True)
        if read_only not in {"false", "0"}:
            raise RuntimeError("Mechanical did not check out a writable license")
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
        workdir = Path(str(client.run_python_script("MSKU_ANALYSIS.WorkingDir")))
        result_file = workdir / "file.rst"
        solver_output = workdir / "solve.out"
        if not result_file.is_file() or result_file.stat().st_size == 0:
            raise RuntimeError("Mechanical reported Done without a nonempty file.rst")
        if not solver_output.is_file():
            raise RuntimeError("Mechanical reported Done without solve.out")
        output = solver_output.read_text(errors="replace")
        if "RUN COMPLETED" not in output or not re.search(
            r"NUMBER OF ERROR\s+MESSAGES ENCOUNTERED\s*=\s*0\b", output
        ):
            raise RuntimeError("MAPDL completion and zero-error evidence are missing")
        print("Result file bytes: " + str(result_file.stat().st_size), flush=True)
        warning_count = re.search(r"NUMBER OF WARNING MESSAGES ENCOUNTERED\s*=\s*(\d+)", output)
        print(
            "MAPDL warning count: " + (warning_count.group(1) if warning_count else "unknown"),
            flush=True,
        )
        print(result.model_dump_json(indent=2), flush=True)
    finally:
        client.exit(force=True)


if __name__ == "__main__":
    main()
