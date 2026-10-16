"""Versioned vehicle-parameter provenance and independent verification axes.

This module stores engineering input provenance.  It deliberately does not
promote numerical or reference evidence into physical correlation evidence.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from math import isfinite
from typing import Literal

EngineeringModule = Literal[
    "geometry",
    "kinematics",
    "quasi_static",
    "quarter_car",
    "full_car_7dof",
    "bicycle",
    "optimization",
]
ParameterSourceKind = Literal[
    "synthetic_assumption",
    "cad",
    "physical_measurement",
    "manufacturer_data",
    "derived",
    "legacy_import",
]
MeasurementStatus = Literal[
    "SYNTHETIC",
    "DECLARED_UNMEASURED",
    "MEASURED",
    "DERIVED_FROM_MEASURED",
]
EvidenceKind = Literal[
    "input_declaration",
    "numerical_benchmark",
    "reference_benchmark",
    "physical_correlation",
]
EvidenceReviewStatus = Literal["pending_review", "accepted", "rejected"]
DeclaredStatus = Literal["DECLARED", "NOT_DECLARED"]
NumericalStatus = Literal[
    "VERIFIED_NUMERICALLY", "PARTIALLY_VERIFIED", "UNVERIFIED", "FAILED"
]
ReferenceStatus = Literal[
    "REFERENCE_BENCHMARKED", "PARTIALLY_BENCHMARKED", "NOT_BENCHMARKED"
]
PhysicalStatus = Literal[
    "PHYSICALLY_CORRELATED", "PARTIALLY_CORRELATED", "UNVALIDATED_PHYSICALLY"
]


@dataclass(frozen=True)
class ParameterUncertainty:
    value: float
    unit: str
    kind: Literal["standard", "expanded", "bound"]
    coverage_factor: float | None = None
    confidence: float | None = None


@dataclass(frozen=True)
class ParameterSource:
    kind: ParameterSourceKind
    label: str
    reference: str | None = None
    recorded_at: str | None = None
    notes: str = ""


@dataclass(frozen=True)
class VehicleParameter:
    key: str
    value: float | tuple[float, ...]
    unit: str
    measurement_status: MeasurementStatus
    source: ParameterSource
    applicable_modules: tuple[EngineeringModule, ...]
    uncertainty: ParameterUncertainty | None = None
    evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class VerificationEvidence:
    id: str
    kind: EvidenceKind
    title: str
    source: str
    recorded_at: str
    review_status: EvidenceReviewStatus
    notes: str = ""
    artifact_sha256: str | None = None


@dataclass(frozen=True)
class VerificationAxes:
    declared: DeclaredStatus = "NOT_DECLARED"
    declared_evidence_ids: tuple[str, ...] = ()
    numerical: NumericalStatus = "UNVERIFIED"
    numerical_evidence_ids: tuple[str, ...] = ()
    reference: ReferenceStatus = "NOT_BENCHMARKED"
    reference_evidence_ids: tuple[str, ...] = ()
    physical: PhysicalStatus = "UNVALIDATED_PHYSICALLY"
    physical_evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class VehicleParameterManifest:
    schema_version: Literal["1.0.0"]
    manifest_id: str
    revision: int
    vehicle_id: str
    configuration_id: str
    configuration_label: str
    created_at: str
    updated_at: str
    parameters: tuple[VehicleParameter, ...]
    verification: VerificationAxes = VerificationAxes()
    evidence: tuple[VerificationEvidence, ...] = ()


def _parameter_values(parameter: VehicleParameter) -> tuple[float, ...]:
    if isinstance(parameter.value, tuple):
        return parameter.value
    return (parameter.value,)


def validate_verification_axes(
    axes: VerificationAxes, evidence: tuple[VerificationEvidence, ...]
) -> tuple[str, ...]:
    """Return validation errors without changing any verification state."""
    errors: list[str] = []
    by_id = {item.id: item for item in evidence}
    if len(by_id) != len(evidence):
        errors.append("Verification evidence identifiers must be unique.")

    requirements = (
        (
            axes.declared == "DECLARED",
            axes.declared_evidence_ids,
            {"input_declaration"},
            "declared",
        ),
        (
            axes.numerical in ("VERIFIED_NUMERICALLY", "PARTIALLY_VERIFIED"),
            axes.numerical_evidence_ids,
            {"numerical_benchmark"},
            "numerical",
        ),
        (
            axes.reference in ("REFERENCE_BENCHMARKED", "PARTIALLY_BENCHMARKED"),
            axes.reference_evidence_ids,
            {"reference_benchmark"},
            "reference",
        ),
        (
            axes.physical in ("PHYSICALLY_CORRELATED", "PARTIALLY_CORRELATED"),
            axes.physical_evidence_ids,
            {"physical_correlation"},
            "physical",
        ),
    )
    for status_requires_evidence, evidence_ids, accepted_kinds, axis in requirements:
        if status_requires_evidence and not evidence_ids:
            errors.append(f"The {axis} verification state requires accepted evidence.")
        for evidence_id in evidence_ids:
            item = by_id.get(evidence_id)
            if item is None:
                errors.append(f"The {axis} axis references missing evidence {evidence_id!r}.")
            elif item.review_status != "accepted":
                errors.append(f"The {axis} axis evidence {evidence_id!r} is not accepted.")
            elif item.kind not in accepted_kinds:
                errors.append(
                    f"The {axis} axis cannot use {item.kind!r} evidence; "
                    f"expected one of {sorted(accepted_kinds)}."
                )
    return tuple(errors)


def validate_vehicle_parameter_manifest(manifest: VehicleParameterManifest) -> tuple[str, ...]:
    """Validate provenance, uncertainty and evidence separation for one manifest."""
    errors: list[str] = []
    if manifest.revision < 1:
        errors.append("Manifest revision must be at least one.")
    if not all(
        value.strip()
        for value in (
            manifest.manifest_id,
            manifest.vehicle_id,
            manifest.configuration_id,
            manifest.configuration_label,
            manifest.created_at,
            manifest.updated_at,
        )
    ):
        errors.append("Manifest identity, configuration and timestamps must be non-empty.")

    keys = [parameter.key for parameter in manifest.parameters]
    if not keys:
        errors.append("A vehicle parameter manifest must contain at least one parameter.")
    if len(keys) != len(set(keys)):
        errors.append("Vehicle parameter keys must be unique.")
    evidence_ids = {item.id for item in manifest.evidence}
    for parameter in manifest.parameters:
        if not parameter.key.strip() or not parameter.unit.strip():
            errors.append("Every vehicle parameter requires a key and unit.")
        values = _parameter_values(parameter)
        if not values or not all(isfinite(value) for value in values):
            errors.append(f"Parameter {parameter.key!r} must contain finite values.")
        if not parameter.applicable_modules:
            errors.append(f"Parameter {parameter.key!r} must name an engineering module.")
        if (
            parameter.source.kind == "synthetic_assumption"
            and parameter.measurement_status != "SYNTHETIC"
        ):
            errors.append(
                f"Synthetic parameter {parameter.key!r} must use measurement status SYNTHETIC."
            )
        if (
            parameter.measurement_status == "MEASURED"
            and parameter.source.kind != "physical_measurement"
        ):
            errors.append(
                f"Measured parameter {parameter.key!r} requires a physical_measurement source."
            )
        if parameter.uncertainty is not None:
            uncertainty = parameter.uncertainty
            if not isfinite(uncertainty.value) or uncertainty.value < 0.0:
                errors.append(f"Parameter {parameter.key!r} has invalid uncertainty.")
            if uncertainty.unit != parameter.unit:
                errors.append(
                    f"Parameter {parameter.key!r} uncertainty unit must match the parameter unit."
                )
            if uncertainty.coverage_factor is not None and (
                not isfinite(uncertainty.coverage_factor) or uncertainty.coverage_factor <= 0.0
            ):
                errors.append(f"Parameter {parameter.key!r} has invalid coverage factor.")
            if uncertainty.confidence is not None and not 0.0 < uncertainty.confidence <= 1.0:
                errors.append(f"Parameter {parameter.key!r} has invalid confidence.")
        for evidence_id in parameter.evidence_ids:
            if evidence_id not in evidence_ids:
                errors.append(
                    f"Parameter {parameter.key!r} references missing evidence {evidence_id!r}."
                )
    errors.extend(validate_verification_axes(manifest.verification, manifest.evidence))
    return tuple(errors)


def vehicle_parameter_manifest_sha256(manifest: VehicleParameterManifest) -> str:
    """Return a deterministic content hash for configuration traceability."""
    canonical = json.dumps(
        asdict(manifest), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
