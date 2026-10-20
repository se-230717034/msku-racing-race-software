"""Local-only ANSYS bridge for MSKU Racing Dynamics Studio."""

from .adapter import MockAnsysAdapter
from .config import BridgeSettings

__all__ = ["BridgeSettings", "MockAnsysAdapter"]
__version__ = "0.1.0"
