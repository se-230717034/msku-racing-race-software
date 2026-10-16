from dataclasses import replace

from msku_engineering.manifest import (
    ParameterSource,
    ParameterUncertainty,
    VehicleParameter,
    VehicleParameterManifest,
    VerificationAxes,
    VerificationEvidence,
    validate_vehicle_parameter_manifest,
    vehicle_parameter_manifest_sha256,
)


def reference_manifest() -> VehicleParameterManifest:
    evidence = (
        VerificationEvidence(
            "input-1",
            "input_declaration",
            "Measured corner mass declaration",
            "setup-sheet.csv",
            "2026-10-16T00:00:00Z",
            "accepted",
            artifact_sha256="a" * 64,
        ),
        VerificationEvidence(
            "numeric-1",
            "numerical_benchmark",
            "Mass mapping regression",
            "test_manifest.py",
            "2026-10-16T00:00:00Z",
            "accepted",
        ),
    )
    return VehicleParameterManifest(
        schema_version="1.0.0",
        manifest_id="msku-2026",
        revision=1,
        vehicle_id="fs-2026",
        configuration_id="dry-setup-a",
        configuration_label="Dry setup A",
        created_at="2026-10-16T00:00:00Z",
        updated_at="2026-10-16T00:00:00Z",
        parameters=(
            VehicleParameter(
                key="vehicle.mass.total",
                value=324.2,
                unit="kg",
                measurement_status="MEASURED",
                source=ParameterSource("physical_measurement", "Calibrated scales"),
                applicable_modules=("quasi_static", "bicycle"),
                uncertainty=ParameterUncertainty(0.4, "kg", "expanded", 2.0, 0.95),
                evidence_ids=("input-1",),
            ),
        ),
        verification=VerificationAxes(
            declared="DECLARED",
            declared_evidence_ids=("input-1",),
            numerical="VERIFIED_NUMERICALLY",
            numerical_evidence_ids=("numeric-1",),
        ),
        evidence=evidence,
    )


def test_manifest_is_valid_and_hash_is_deterministic() -> None:
    manifest = reference_manifest()
    assert validate_vehicle_parameter_manifest(manifest) == ()
    assert vehicle_parameter_manifest_sha256(manifest) == vehicle_parameter_manifest_sha256(
        manifest
    )
    assert len(vehicle_parameter_manifest_sha256(manifest)) == 64


def test_empty_manifest_is_rejected() -> None:
    errors = validate_vehicle_parameter_manifest(replace(reference_manifest(), parameters=()))
    assert any("at least one parameter" in error for error in errors)


def test_synthetic_assumption_cannot_be_presented_as_measured() -> None:
    manifest = reference_manifest()
    parameter = replace(
        manifest.parameters[0],
        measurement_status="MEASURED",
        source=ParameterSource("synthetic_assumption", "Demonstration default"),
    )
    errors = validate_vehicle_parameter_manifest(replace(manifest, parameters=(parameter,)))
    assert any("Synthetic parameter" in error for error in errors)
    assert any("physical_measurement" in error for error in errors)


def test_numerical_evidence_cannot_promote_physical_correlation() -> None:
    manifest = reference_manifest()
    axes = replace(
        manifest.verification,
        physical="PHYSICALLY_CORRELATED",
        physical_evidence_ids=("numeric-1",),
    )
    errors = validate_vehicle_parameter_manifest(replace(manifest, verification=axes))
    assert any("physical axis cannot use" in error for error in errors)


def test_physical_correlation_requires_accepted_physical_evidence() -> None:
    manifest = reference_manifest()
    physical = VerificationEvidence(
        "physical-1",
        "physical_correlation",
        "Four-post correlation",
        "four-post-run-17.csv",
        "2026-10-16T00:00:00Z",
        "pending_review",
    )
    axes = replace(
        manifest.verification,
        physical="PHYSICALLY_CORRELATED",
        physical_evidence_ids=("physical-1",),
    )
    errors = validate_vehicle_parameter_manifest(
        replace(manifest, verification=axes, evidence=(*manifest.evidence, physical))
    )
    assert any("is not accepted" in error for error in errors)
