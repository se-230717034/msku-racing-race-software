"""Numerical core for MSKU Racing Dynamics Studio."""

from .geometry import Diagnostic, GeometryError, Link, link_lengths, validate_corner
from .kinematics import (
    KINEMATICS_SOLVER_VERSION,
    PHYSICAL_STATUS,
    REFERENCE_STATUS,
    KinematicMetrics,
    KinematicPose,
    KinematicState,
    SolverDiagnostics,
    SolverSettings,
    SweepResult,
    solve_pose,
    solve_sweep,
)

__all__ = [
    "Diagnostic",
    "GeometryError",
    "KINEMATICS_SOLVER_VERSION",
    "KinematicMetrics",
    "KinematicPose",
    "KinematicState",
    "Link",
    "PHYSICAL_STATUS",
    "REFERENCE_STATUS",
    "SolverDiagnostics",
    "SolverSettings",
    "SweepResult",
    "link_lengths",
    "solve_pose",
    "solve_sweep",
    "validate_corner",
]
