"""Vercel entry point for the MSKU Racing FastAPI service."""

import sys
from importlib import import_module
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "engineering" / "src"))

app = import_module("msku_api.main").app

__all__ = ["app"]
