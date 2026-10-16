"""Static suspension geometry checks.

Coordinates use SI metres in the right-handed vehicle frame: +X forward,
+Y left, +Z up. This module does not perform kinematic or force analysis.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class Link:
    id: str
    start: str
    end: str


@dataclass(frozen=True)
class Diagnostic:
    severity: Severity
    code: str
    message: str
    points: tuple[str, ...] = ()


class GeometryError(ValueError):
    """Raised when geometry cannot be evaluated safely."""


LINKS: tuple[Link, ...] = (
    Link("uca_front_leg", "uca_front_inboard", "uca_outboard"),
    Link("uca_rear_leg", "uca_rear_inboard", "uca_outboard"),
    Link("lca_front_leg", "lca_front_inboard", "lca_outboard"),
    Link("lca_rear_leg", "lca_rear_inboard", "lca_outboard"),
    Link("tie_rod", "tie_rod_inboard", "tie_rod_outboard"),
    Link("upright", "lca_outboard", "uca_outboard"),
    Link("wheel_reference", "lca_outboard", "wheel_center"),
)

REQUIRED_IDS = frozenset(point for link in LINKS for point in (link.start, link.end))
MIN_LINK_LENGTH_M = 0.001
MIN_PIVOT_SEPARATION_M = 0.010


def _point(points: Mapping[str, Sequence[float]], point_id: str) -> NDArray[np.float64]:
    if point_id not in points:
        raise GeometryError(f"Missing required hardpoint: {point_id}")
    value = np.asarray(points[point_id], dtype=np.float64)
    if value.shape != (3,) or not np.all(np.isfinite(value)):
        raise GeometryError(f"Hardpoint {point_id} must contain three finite coordinates")
    return value


def link_lengths(points: Mapping[str, Sequence[float]]) -> dict[str, float]:
    """Return deterministic Euclidean lengths in metres for the static link topology."""
    return {
        link.id: float(np.linalg.norm(_point(points, link.end) - _point(points, link.start)))
        for link in LINKS
    }


def validate_corner(
    points: Mapping[str, Sequence[float]],
    wheel_radius_m: float,
    wheel_width_m: float,
    corner: Literal["front_left", "front_right", "rear_left", "rear_right"] = "front_left",
) -> list[Diagnostic]:
    """Validate one static corner without claiming mechanism feasibility."""
    diagnostics: list[Diagnostic] = []

    try:
        resolved = {point_id: _point(points, point_id) for point_id in REQUIRED_IDS}
    except GeometryError as exc:
        return [Diagnostic("error", "INVALID_HARDPOINT", str(exc))]

    for link, length in zip(LINKS, link_lengths(points).values(), strict=True):
        if length < MIN_LINK_LENGTH_M:
            diagnostics.append(
                Diagnostic(
                    "error",
                    "DEGENERATE_LINK",
                    f"{link.id} is {length * 1000:.3f} mm; minimum is 1.000 mm.",
                    (link.start, link.end),
                )
            )

    for first, second, label in (
        ("uca_front_inboard", "uca_rear_inboard", "upper wishbone inboard pivots"),
        ("lca_front_inboard", "lca_rear_inboard", "lower wishbone inboard pivots"),
    ):
        separation = float(np.linalg.norm(resolved[first] - resolved[second]))
        if separation < MIN_PIVOT_SEPARATION_M:
            diagnostics.append(
                Diagnostic(
                    "error",
                    "COINCIDENT_PIVOTS",
                    f"The {label} are only {separation * 1000:.3f} mm apart.",
                    (first, second),
                )
            )

    if resolved["uca_outboard"][2] <= resolved["lca_outboard"][2]:
        diagnostics.append(
            Diagnostic(
                "error",
                "UPRIGHT_ORDER",
                "Upper upright joint must be above the lower upright joint (+Z).",
                ("uca_outboard", "lca_outboard"),
            )
        )

    inboard_ids = (
        "uca_front_inboard",
        "uca_rear_inboard",
        "lca_front_inboard",
        "lca_rear_inboard",
        "tie_rod_inboard",
    )
    outboard_y = (
        resolved["uca_outboard"][1],
        resolved["lca_outboard"][1],
        resolved["tie_rod_outboard"][1],
    )
    if corner.endswith("left"):
        boundary = min(outboard_y)
        misplaced = tuple(point_id for point_id in inboard_ids if resolved[point_id][1] >= boundary)
    else:
        boundary = max(outboard_y)
        misplaced = tuple(point_id for point_id in inboard_ids if resolved[point_id][1] <= boundary)
    if misplaced:
        diagnostics.append(
            Diagnostic(
                "error",
                "CORNER_ORDER",
                "Inboard joints must be closer to the vehicle centreline than outboard joints.",
                misplaced,
            )
        )

    upright_y = (resolved["uca_outboard"][1], resolved["lca_outboard"][1])
    wheel_is_inboard = (
        resolved["wheel_center"][1] < max(upright_y)
        if corner.endswith("left")
        else resolved["wheel_center"][1] > min(upright_y)
    )
    if wheel_is_inboard:
        diagnostics.append(
            Diagnostic(
                "warning",
                "WHEEL_CENTER_INBOARD",
                "Wheel centre is inboard of an upright joint; verify wheel-offset convention.",
                ("wheel_center", "uca_outboard", "lca_outboard"),
            )
        )

    if not np.isfinite(wheel_radius_m) or wheel_radius_m <= 0:
        diagnostics.append(
            Diagnostic("error", "WHEEL_RADIUS", "Wheel radius must be positive and finite.")
        )
    if not np.isfinite(wheel_width_m) or wheel_width_m <= 0:
        diagnostics.append(
            Diagnostic("error", "WHEEL_WIDTH", "Wheel width must be positive and finite.")
        )
    if wheel_width_m >= 2 * wheel_radius_m:
        diagnostics.append(
            Diagnostic(
                "warning",
                "WHEEL_PROPORTION",
                "Wheel width is at least the wheel diameter; verify units.",
            )
        )

    return diagnostics
