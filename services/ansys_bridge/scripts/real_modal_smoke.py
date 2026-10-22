"""Opt-in licensed Student modal smoke; never part of CI or Vercel."""

from __future__ import annotations

from msku_ansys_bridge.adapter import PyMechanicalLauncher
from msku_ansys_bridge.config import BridgeSettings
from msku_ansys_bridge.discovery import discover_windows_installations
from msku_ansys_bridge.modal import ModalAnalysisRequest, run_modal_analysis
from sample_cad import official_example_cad


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
    try:
        read_only = str(client.run_python_script(
            "Ansys.ACT.Mechanical.MechanicalAPI.Instance.ReadOnlyMode"
        )).strip().casefold()
        if read_only not in {"false", "0"}:
            raise RuntimeError("Mechanical did not check out a writable license")
        print("Mechanical product: " + str(client.get_product_info()), flush=True)
        result = run_modal_analysis(
            client,
            ModalAnalysisRequest(
                geometryPath=official_example_cad(),
                fixedNamedSelection="NS_Fixed",
                meshSizeMm=500,
                modeCount=3,
            ),
            lambda stage, message: print(stage + ": " + message, flush=True),
        )
        print(result.model_dump_json(indent=2), flush=True)
    finally:
        client.exit(force=True)


if __name__ == "__main__":
    main()
