"""Use the pinned official example CAD from local cache when offline."""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path

from ansys.mechanical.core.examples import download_file

EXPECTED_SHA256 = "49756ab321a4736c5ba94a318e5bf38363a032c8a9c210a817ce1910c1a201f8"


def official_example_cad() -> str:
    cached = Path(tempfile.gettempdir()) / "pymechanical" / "00_basic" / "example_01_geometry.agdb"
    if cached.is_file() and hashlib.sha256(cached.read_bytes()).hexdigest() == EXPECTED_SHA256:
        return str(cached)
    downloaded = Path(
        download_file(
            "example_01_geometry.agdb",
            "pymechanical",
            "00_basic",
            destination=tempfile.gettempdir(),
        )
    )
    if hashlib.sha256(downloaded.read_bytes()).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError("Official example CAD hash differs from the pinned smoke-test fixture")
    return str(downloaded)
