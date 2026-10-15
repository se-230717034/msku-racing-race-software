from math import isclose

from msku_engineering.geometry import link_lengths, validate_corner


def demo_points() -> dict[str, tuple[float, float, float]]:
    return {
        "uca_front_inboard": (0.18, 0.31, 0.46),
        "uca_rear_inboard": (-0.16, 0.30, 0.45),
        "uca_outboard": (0.01, 0.64, 0.40),
        "lca_front_inboard": (0.22, 0.27, 0.19),
        "lca_rear_inboard": (-0.19, 0.26, 0.18),
        "lca_outboard": (0.0, 0.68, 0.17),
        "tie_rod_inboard": (-0.12, 0.29, 0.25),
        "tie_rod_outboard": (-0.09, 0.67, 0.26),
        "wheel_center": (0.0, 0.72, 0.285),
    }


def test_demo_geometry_has_no_diagnostics() -> None:
    assert validate_corner(demo_points(), 0.2286, 0.18) == []


def test_link_lengths_are_euclidean_and_deterministic() -> None:
    first = link_lengths(demo_points())
    second = link_lengths(demo_points())
    assert first == second
    # Independent baseline: sqrt(0.01^2 + (-0.04)^2 + 0.23^2).
    assert isclose(first["upright"], 0.23366642891095848, rel_tol=1e-12)


def test_rejects_reversed_upright() -> None:
    points = demo_points()
    points["uca_outboard"] = (0.01, 0.64, 0.10)
    assert "UPRIGHT_ORDER" in {item.code for item in validate_corner(points, 0.2286, 0.18)}


def test_detects_coincident_link_points() -> None:
    points = demo_points()
    points["tie_rod_outboard"] = points["tie_rod_inboard"]
    assert "DEGENERATE_LINK" in {item.code for item in validate_corner(points, 0.2286, 0.18)}


def test_rejects_invalid_wheel_dimensions() -> None:
    codes = {item.code for item in validate_corner(demo_points(), 0.0, -1.0)}
    assert {"WHEEL_RADIUS", "WHEEL_WIDTH"} <= codes
