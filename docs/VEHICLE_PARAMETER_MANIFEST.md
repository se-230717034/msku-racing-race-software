# Vehicle Parameter Manifest and verification axes

Status: implemented, schema `1.0.0`
Updated: 2026-10-16

## Purpose

The Vehicle Parameter Manifest records which exact vehicle configuration and engineering inputs were used by a calculation. It separates input traceability from numerical acceptance, reference benchmarking, and physical correlation. A successful solver run is never evidence that a real vehicle has been physically validated.

The manifest is optional at the API boundary to preserve existing clients. When omitted from an otherwise successful calculation, the API returns `VEHICLE_PARAMETER_MANIFEST_NOT_PROVIDED`. Existing calculation fields and request shapes remain valid.

## Manifest identity

Every manifest contains:

- `schemaVersion`: currently `1.0.0`;
- `manifestId` and integer `revision`;
- `vehicleId`, `configurationId`, and a human-readable `configurationLabel`;
- `createdAt` and `updatedAt` timestamps;
- parameter records, independent verification axes, and evidence records.

A canonical SHA-256 hash can be generated from the complete manifest. The hash is deterministic and changes when any stored configuration, parameter, source, uncertainty, evidence, or status changes.

## Parameter records

Each parameter records a unique key, scalar or vector value, SI unit, applicable engineering modules, measurement status, source, optional uncertainty, and evidence identifiers.

Measurement states are:

- `SYNTHETIC`: demonstration or assumed input, not measured;
- `DECLARED_UNMEASURED`: supplied without measurement evidence;
- `MEASURED`: must use a `physical_measurement` source;
- `DERIVED_FROM_MEASURED`: calculated from measured inputs and traceable to evidence.

Source kinds are `synthetic_assumption`, `cad`, `physical_measurement`, `manufacturer_data`, `derived`, and `legacy_import`. A `synthetic_assumption` is rejected unless its measurement state is `SYNTHETIC`. Conversely, `MEASURED` is rejected unless its source is `physical_measurement`.

Uncertainty records store value, matching unit, uncertainty kind (`standard`, `expanded`, or `bound`), and optional coverage factor/confidence. Unknown uncertainty is represented by omitting the uncertainty record; it is never silently converted to zero uncertainty.

## Independent verification axes

The following axes are stored and evaluated independently:

| Axis | States | Required accepted evidence |
| --- | --- | --- |
| Declared | `DECLARED`, `NOT_DECLARED` | `input_declaration` |
| Numerical | `VERIFIED_NUMERICALLY`, `PARTIALLY_VERIFIED`, `UNVERIFIED`, `FAILED` | `numerical_benchmark` for a promoted state |
| Reference | `REFERENCE_BENCHMARKED`, `PARTIALLY_BENCHMARKED`, `NOT_BENCHMARKED` | `reference_benchmark` for a promoted state |
| Physical | `PHYSICALLY_CORRELATED`, `PARTIALLY_CORRELATED`, `UNVALIDATED_PHYSICALLY` | `physical_correlation` for a promoted state |

Evidence has its own identifier, kind, title, source, timestamp, review status, notes, and optional artifact SHA-256. Promoted states require accepted evidence of the matching kind. Numerical or reference evidence cannot be attached to the physical axis, and passing automated tests cannot promote physical correlation.

Runtime API responses include `verificationAxes` as a calculation-specific snapshot. It declares the request, records numerical acceptance/failure, identifies the solver's independent regression-suite status, and always leaves physical correlation as `UNVALIDATED_PHYSICALLY` unless an external reviewed workflow supplies real physical evidence. The current application does not auto-approve such evidence.

## 7DOF contact acceptance hardening

The full-car 7DOF solver now evaluates total tire normal force at both accepted integration states and every reported dense-output sample. If any reported point predicts negative total normal force below tolerance, the result is `FAILED`, samples are suppressed, the responsible corner and minimum force are retained in diagnostics, and the warning `TIRE_CONTACT_LOSS_AT_REPORTED_SAMPLE_UNSUPPORTED` is returned. This closes the former gap where an invalid dense interpolant could be exposed even though the integrator endpoints were acceptable.

This remains a bilateral linear-tire model. Failure suppression prevents unsupported output; it does not add lift-off/recontact physics.

## Current limitations and required evidence

- Bundled demonstration parameters remain explicitly synthetic.
- Existing project-level legacy validation fields remain for backward compatibility; the new four axes are authoritative for independent evidence semantics.
- A manifest provides provenance, not proof that a value is correct.
- Physical correlation requires controlled CAD/measurement artifacts, calibrated sensors, test conditions, uncertainty treatment, and an accepted `physical_correlation` evidence record.
- No solver result or automated regression test grants engineering approval.
