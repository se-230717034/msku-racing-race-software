"""Opt-in real solve of Ansys' small AGDB example; never runs in CI or Vercel."""

from __future__ import annotations

import os
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
        mesh_study = os.getenv("MSKU_ANSYS_SMOKE_MESH_STUDY") == "1"
        request = StaticAnalysisRequest(
            geometryPath=sample,
            fixedNamedSelection="NS_Fixed",
            forceNamedSelection="NS_Face_1",
            forceAxis="X",
            forceN=1000.0,
            meshSizeMm=300.0 if mesh_study else 500.0,
            meshConvergenceSizesMm=[500.0, 400.0, 300.0] if mesh_study else None,
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
        error_file = workdir / "file0.err"
        error_text = (
            error_file.read_text(errors="replace").casefold() if error_file.is_file() else ""
        )
        solver_input = workdir / "ds.dat"
        input_text = (
            solver_input.read_text(errors="replace").upper() if solver_input.is_file() else ""
        )
        print(
            "Shape-check snippet in solver input: "
            + str("SHPP,ON,ALL" in input_text and "CHECK" in input_text),
            flush=True,
        )
        print(
            "High-risk warning flags: shape_inactive="
            + str("element shape checking is currently inactive" in error_text)
            + ", reduced_integration_pcg="
            + str("reduced integration brick" in error_text and "pcg solver" in error_text),
            flush=True,
        )
        print(
            "Remaining warning categories: missing_surface_material="
            + str(
                re.search(
                    r"material number\s+\d+.*?at least\s+one mp or one tb",
                    error_text,
                    re.DOTALL,
                ) is not None
            )
            + ", element_shape_error="
            + str("element shape" in error_text and "error" in error_text),
            flush=True,
        )
        print("Sparse/direct solver log marker: " + str("SPARSE" in output.upper()), flush=True)
        print(result.model_dump_json(indent=2), flush=True)
    finally:
        client.exit(force=True)


if __name__ == "__main__":
    main()
