from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Vec3(StrictModel):
    x: float
    y: float
    z: float


class Hardpoint(StrictModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    group: Literal["upper_wishbone", "lower_wishbone", "steering", "upright", "wheel"]
    position: Vec3


class Wheel(StrictModel):
    radius: float = Field(gt=0)
    width: float = Field(gt=0)
    staticCamberRad: float = Field(default=0.0, ge=-0.35, le=0.35)
    staticToeRad: float = Field(default=0.0, ge=-0.35, le=0.35)


class DamperDefinition(StrictModel):
    rockerPickup: Vec3
    chassisPickup: Vec3
    compressionCoefficientNsPerM: float = Field(ge=0)
    reboundCoefficientNsPerM: float = Field(ge=0)


class ActuationGeometry(StrictModel):
    type: Literal["pushrod", "pullrod"]
    uprightPickup: Vec3
    rockerPushrodPickup: Vec3
    rockerSpringPickup: Vec3
    rockerAxisStart: Vec3
    rockerAxisEnd: Vec3
    springChassisPickup: Vec3
    springFreeLengthM: float = Field(gt=0)
    springRateNPerM: float = Field(gt=0)
    springPreloadN: float = Field(default=0.0, ge=0)
    damper: DamperDefinition | None = None


class Suspension(StrictModel):
    type: Literal["double_wishbone"]
    corner: Literal["front_left", "front_right"]
    hardpoints: list[Hardpoint] = Field(min_length=9, max_length=9)
    wheel: Wheel
    actuation: ActuationGeometry | None = None

    @model_validator(mode="after")
    def hardpoint_ids_are_unique(self) -> Suspension:
        ids = [point.id for point in self.hardpoints]
        if len(ids) != len(set(ids)):
            raise ValueError("hardpoint identifiers must be unique")
        return self


class Units(StrictModel):
    length: Literal["m"]
    angle: Literal["rad"]


class CoordinateSystem(StrictModel):
    handedness: Literal["right"]
    xAxis: Literal["forward"]
    yAxis: Literal["left"]
    zAxis: Literal["up"]


class Project(StrictModel):
    schemaVersion: Literal["1.0.0"]
    projectId: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=500)
    createdAt: datetime
    updatedAt: datetime
    dataClassification: Literal["demonstration", "team_private"]
    modelStatus: Literal["demonstration", "unvalidated", "benchmarked", "experimentally_validated"]
    units: Units
    coordinateSystem: CoordinateSystem
    suspension: Suspension


class DiagnosticResponse(StrictModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    points: list[str]


class ProjectValidationResponse(StrictModel):
    valid: bool
    schemaVersion: Literal["1.0.0"]
    units: dict[str, str]
    diagnostics: list[DiagnosticResponse]


class SweepDefinition(StrictModel):
    startTravelM: float = Field(default=-0.05, ge=-0.25, le=0.25)
    endTravelM: float = Field(default=0.05, ge=-0.25, le=0.25)
    steps: int = Field(default=41, ge=3, le=401)

    @model_validator(mode="after")
    def travel_range_is_increasing(self) -> SweepDefinition:
        if self.endTravelM <= self.startTravelM:
            raise ValueError("endTravelM must be greater than startTravelM")
        return self


class SolverConfiguration(StrictModel):
    residualToleranceM: float = Field(default=1.0e-8, ge=1.0e-12, le=1.0e-4)
    maxFunctionEvaluations: int = Field(default=500, ge=50, le=5000)


class KinematicsSweepRequest(StrictModel):
    project: Project
    sweep: SweepDefinition = Field(default_factory=SweepDefinition)
    solver: SolverConfiguration = Field(default_factory=SolverConfiguration)


class SolverDiagnosticsResponse(StrictModel):
    converged: bool
    optimizerSuccess: bool
    residualsAccepted: bool
    jacobianAccepted: bool
    continuityAccepted: bool
    residualNormM: float | None
    maxAbsResidualM: float | None
    jacobianRank: int
    jacobianCondition: float | None
    functionEvaluations: int
    message: str


class KinematicMetricsResponse(StrictModel):
    camberRad: float
    camberChangeRad: float
    camberGainRadPerM: float | None
    toeRad: float
    bumpSteerRad: float
    bumpSteerGradientRadPerM: float | None
    casterRad: float
    kpiRad: float
    trackChangeM: float
    rollCenterHeightM: float | None
    instantCenterYM: float | None
    instantCenterZM: float | None


class KinematicPoseResponse(StrictModel):
    hardpoints: dict[str, Vec3]
    wheelAxis: Vec3
    translation: Vec3
    rotationVector: Vec3


class KinematicStateResponse(StrictModel):
    travelM: float
    calculationStatus: Literal["VERIFIED_NUMERICALLY", "FAILED"]
    pose: KinematicPoseResponse | None
    metrics: KinematicMetricsResponse | None
    diagnostics: SolverDiagnosticsResponse
    warnings: list[str]


class ValidationStatusResponse(StrictModel):
    numerical: Literal["VERIFIED_NUMERICALLY", "FAILED"]
    reference: Literal["REFERENCE_BENCHMARKED"]
    physical: Literal["UNVALIDATED_PHYSICALLY"]
    engineeringApproval: Literal["NOT_APPROVED"]


class SolverMetadataResponse(StrictModel):
    name: Literal["rigid_upright_double_wishbone"]
    version: str
    residualToleranceM: float
    rankRelativeTolerance: float
    conditionLimit: float
    continuityPositionLimitM: float
    continuityRotationLimitRad: float
    maximumTravelStepM: float
    maxFunctionEvaluations: int
    gradientMethod: Literal["second_order_nonuniform_finite_difference"]


class InputProvenanceResponse(StrictModel):
    projectId: str
    projectName: str
    dataClassification: Literal["demonstration", "team_private"]
    declaredModelStatus: Literal[
        "demonstration", "unvalidated", "benchmarked", "experimentally_validated"
    ]
    projectInputSha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class KinematicsSweepResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    modelStatus: Literal["unvalidated"]
    units: dict[str, str]
    allConverged: bool
    validationStatus: ValidationStatusResponse
    solver: SolverMetadataResponse
    inputProvenance: InputProvenanceResponse
    warnings: list[str]
    residualToleranceM: float
    states: list[KinematicStateResponse]


Phase3CalculationStatus = Literal["VERIFIED_NUMERICALLY", "NOT_COMPUTABLE", "FAILED"]


class Phase3ValidationStatusResponse(StrictModel):
    numerical: Phase3CalculationStatus
    reference: Literal["REFERENCE_BENCHMARKED"] = "REFERENCE_BENCHMARKED"
    physical: Literal["UNVALIDATED_PHYSICALLY"] = "UNVALIDATED_PHYSICALLY"
    engineeringApproval: Literal["NOT_APPROVED"] = "NOT_APPROVED"


class ExternalWrenchInput(StrictModel):
    forceN: Vec3
    momentNm: Vec3
    applicationPointM: Vec3


class AdditionalMemberInput(StrictModel):
    id: str = Field(min_length=1)
    chassisPointM: Vec3
    uprightPointM: Vec3


class EquilibriumSolverConfiguration(StrictModel):
    forceToleranceN: float = Field(default=1.0e-6, gt=0, le=1.0)
    momentToleranceNm: float = Field(default=1.0e-6, gt=0, le=1.0)
    rankRelativeTolerance: float = Field(default=1.0e-10, gt=0, le=1.0e-3)
    conditionLimit: float = Field(default=1.0e10, gt=1.0, le=1.0e14)


class UprightEquilibriumRequest(StrictModel):
    project: Project
    travelM: float = Field(default=0.0, ge=-0.25, le=0.25)
    externalWrench: ExternalWrenchInput
    additionalMember: AdditionalMemberInput | None = None
    solver: EquilibriumSolverConfiguration = Field(default_factory=EquilibriumSolverConfiguration)


class MemberForceResponse(StrictModel):
    id: str
    axialForceN: float
    state: Literal["TENSION", "COMPRESSION", "ZERO"]
    forceOnUprightN: Vec3
    chassisReactionN: Vec3
    uprightPointM: Vec3


class EquilibriumDiagnosticsResponse(StrictModel):
    matrixRows: int
    matrixColumns: int
    matrixRank: int
    conditionNumber: float | None
    forceResidualN: Vec3
    momentResidualNm: Vec3
    forceResidualNormN: float
    momentResidualNormNm: float
    characteristicLengthM: float
    message: str


class UprightEquilibriumResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    calculationStatus: Phase3CalculationStatus
    validationStatus: Phase3ValidationStatusResponse
    solverVersion: str
    units: dict[str, str]
    inputProvenance: InputProvenanceResponse
    pose: KinematicPoseResponse
    memberForces: list[MemberForceResponse]
    diagnostics: EquilibriumDiagnosticsResponse
    warnings: list[str]


class VehicleLoadTransferRequest(StrictModel):
    massKg: float
    wheelbaseM: float
    cgFromFrontAxleM: float
    cgHeightM: float
    frontTrackM: float
    rearTrackM: float
    longitudinalAccelerationMps2: float = 0.0
    lateralAccelerationMps2: float = 0.0
    gravityMps2: float = 9.80665
    frontRollStiffnessNmPerRad: float | None = None
    rearRollStiffnessNmPerRad: float | None = None


class AxleLoadsResponse(StrictModel):
    frontN: float
    rearN: float


class WheelLoadsResponse(StrictModel):
    frontLeftN: float
    frontRightN: float
    rearLeftN: float
    rearRightN: float


class VehicleLoadTransferResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    calculationStatus: Phase3CalculationStatus
    validationStatus: Phase3ValidationStatusResponse
    solverVersion: str
    modelName: Literal["rigid_body_with_elastic_roll_stiffness_distribution"]
    units: dict[str, str]
    axleLoads: AxleLoadsResponse | None
    wheelLoads: WheelLoadsResponse | None
    longitudinalTransferN: float | None
    frontLateralTransferN: float | None
    rearLateralTransferN: float | None
    totalWeightN: float | None
    forceResidualN: float | None
    warnings: list[str]


class ActuationSeriesRequest(StrictModel):
    wheelTravelM: list[float] = Field(min_length=3)
    springLengthM: list[float] = Field(min_length=3)
    referenceSpringLengthM: float
    springRateNPerM: float
    preloadN: float = 0.0
    compressionOnly: bool = True

    @model_validator(mode="after")
    def arrays_have_equal_length(self) -> ActuationSeriesRequest:
        if len(self.wheelTravelM) != len(self.springLengthM):
            raise ValueError("wheelTravelM and springLengthM must have equal length")
        return self


class SpringSampleResponse(StrictModel):
    wheelTravelM: float
    springLengthM: float
    springCompressionM: float
    motionRatio: float
    springForceN: float
    storedEnergyJ: float
    wheelForceN: float
    wheelRateNPerM: float


class ActuationSeriesResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    calculationStatus: Phase3CalculationStatus
    validationStatus: Phase3ValidationStatusResponse
    solverVersion: str
    units: dict[str, str]
    samples: list[SpringSampleResponse]
    warnings: list[str]


class DamperForceRequest(StrictModel):
    velocityMps: float | None = None
    compressionCoefficientNsPerM: float
    reboundCoefficientNsPerM: float


class DamperForceResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    calculationStatus: Phase3CalculationStatus
    forceN: float | None
    warning: str | None
    physicalStatus: Literal["UNVALIDATED_PHYSICALLY"] = "UNVALIDATED_PHYSICALLY"


class QuarterCarParametersInput(StrictModel):
    sprungMassKg: float
    unsprungMassKg: float
    suspensionStiffnessNPerM: float
    suspensionDampingNsPerM: float
    tireStiffnessNPerM: float
    tireDampingNsPerM: float = 0.0
    staticTireLoadN: float | None = None


class RoadProfileInput(StrictModel):
    kind: Literal["step", "smooth_bump", "half_sine", "sine", "sampled"]
    amplitudeM: float = 0.0
    startTimeS: float = 0.0
    durationS: float = 0.1
    frequencyHz: float = 1.0
    sampleTimesS: list[float] = Field(default_factory=list)
    sampleDisplacementsM: list[float] = Field(default_factory=list)


class QuarterCarInitialStateInput(StrictModel):
    sprungDisplacementM: float = 0.0
    sprungVelocityMps: float = 0.0
    unsprungDisplacementM: float = 0.0
    unsprungVelocityMps: float = 0.0


class DynamicsSettingsInput(StrictModel):
    durationS: float = 2.0
    outputSamples: int = 501
    relativeTolerance: float = 1.0e-8
    absoluteTolerance: float = 1.0e-10
    maximumStepS: float = 0.005
    method: Literal["DOP853", "Radau", "BDF"] = "DOP853"


class QuarterCarSimulationRequest(StrictModel):
    dataClassification: Literal["demonstration", "team_private"]
    sourceLabel: str = Field(min_length=1, max_length=160)
    parameters: QuarterCarParametersInput
    road: RoadProfileInput
    initialState: QuarterCarInitialStateInput = Field(default_factory=QuarterCarInitialStateInput)
    settings: DynamicsSettingsInput = Field(default_factory=DynamicsSettingsInput)


class DynamicsInputProvenanceResponse(StrictModel):
    dataClassification: Literal["demonstration", "team_private"]
    sourceLabel: str
    inputSha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class QuarterCarSampleResponse(StrictModel):
    timeS: float
    roadDisplacementM: float
    roadVelocityMps: float
    sprungDisplacementM: float
    sprungVelocityMps: float
    sprungAccelerationMps2: float
    unsprungDisplacementM: float
    unsprungVelocityMps: float
    unsprungAccelerationMps2: float
    suspensionTravelM: float
    tireCompressionM: float
    suspensionForceOnSprungN: float
    tireForceIncrementN: float
    totalTireContactForceN: float | None
    mechanicalEnergyJ: float
    dissipatedPowerW: float
    roadInputPowerW: float


class DynamicsDiagnosticsResponse(StrictModel):
    solverSuccess: bool
    finiteStates: bool
    contactAccepted: bool | None
    functionEvaluations: int
    jacobianEvaluations: int
    luDecompositions: int
    integrationMethod: Literal["DOP853", "Radau", "BDF"]
    relativeTolerance: float
    absoluteTolerance: float
    maximumStepS: float
    acceptedSteps: int
    minimumAcceptedStepS: float | None
    maximumAcceptedStepS: float | None
    initialEnergyJ: float | None
    finalEnergyJ: float | None
    roadInputWorkJ: float | None
    dissipatedEnergyJ: float | None
    energyBalanceResidualJ: float | None
    relativeEnergyBalanceError: float | None
    minimumTotalContactForceN: float | None
    message: str


class QuarterCarSimulationResponse(StrictModel):
    schemaVersion: Literal["1.0.0"]
    modelName: Literal["linear_quarter_car_2dof"]
    calculationStatus: Phase3CalculationStatus
    validationStatus: Phase3ValidationStatusResponse
    solverVersion: str
    units: dict[str, str]
    inputProvenance: DynamicsInputProvenanceResponse
    naturalFrequenciesHz: list[float] | None
    diagnostics: DynamicsDiagnosticsResponse
    assumptions: list[str]
    warnings: list[str]
    samples: list[QuarterCarSampleResponse]
