"""Local-only ANSYS bridge for MSKU Racing Dynamics Studio."""

from .adapter import LocalAnsysAdapter
from .config import BridgeSettings

__all__ = ["BridgeSettings", "LocalAnsysAdapter"]
__version__ = "0.4.0"
