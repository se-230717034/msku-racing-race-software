"""Explicit, local-only Static Structural jobs; no synthetic engineering results."""

from __future__ import annotations

import ctypes
import hashlib
import json
import math
import os
import re
import tempfile
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .adapter import MechanicalClient
from .studio_transfer import StudioTransfer, StudioTransferEvidence, Vector3, transfer_evidence

_T = TypeVar("_T")
AnalysisStage = Literal["queued", "importing", "meshing", "solving", "extracting", "done"]
SUPPORTED_CAD_SUFFIXES = frozenset({".agdb", ".pmdb", ".step", ".stp"})
# Published Student structural limit is 128K nodes/elements. Mesh counts can undercount
# solver-generated entities, so this is a preflight rejection, not a license guarantee.
STUDENT_MESH_PRECHECK_LIMIT = 128_000
# Student's included solver entitlement allowed two cores on the tested v261 install.
# A lower core count is a solve-process setting, not a substitute for a solver license.
STUDENT_SAFE_SOLVE_CORES = 2
MESH_CONVERGENCE_TOLERANCE_RELATIVE = 0.05
_QUANTITY = re.compile(
    r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*\[\s*([^\]]+)\s*\]\s*$"
)


class StaticAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    geometryPath: str = Field(min_length=1, max_length=1024)
    material: Literal["Structural Steel"] = "Structural Steel"
    fixedNamedSelection: str = Field(min_length=1, max_length=100)
    forceNamedSelection: str = Field(min_length=1, max_length=100)
    forceAxis: Literal["X", "Y", "Z"] = "Z"
    forceN: float = Field(ge=-1_000_000, le=1_000_000, allow_inf_nan=False)
    forceComponentsN: Vector3 | None = None
    forceInputSha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    forceApplicationPointVehicleM: Vector3 | None = None
    meshSizeMm: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)
    meshConvergenceSizesMm: list[float] | None = Field(default=None, min_length=3, max_length=3)
    studioTransfer: StudioTransfer | None = None

    @field_validator("fixedNamedSelection", "forceNamedSelection")
    @classmethod
    def validate_selection_name(cls, value: str) -> str:
        if value != value.strip() or not re.fullmatch(r"[\w .-]+", value):
            raise ValueError(
                "Named selection adı yalnızca harf, sayı, boşluk, _, . ve - içerebilir."
            )
        return value

    @model_validator(mode="after")
    def validate_load(self) -> StaticAnalysisRequest:
        if self.forceComponentsN is None and self.forceN == 0:
            raise ValueError("Kuvvet sıfır olamaz.")
        if self.forceComponentsN is not None:
            components = self.forceComponentsN.components()
            magnitude = math.dist(components, (0, 0, 0))
            if magnitude <= 0 or any(abs(component) > 1_000_000 for component in components):
                raise ValueError("Kuvvet bileşenleri sonlu, sınırlı ve sıfırdan farklı olmalı.")
            if not math.isclose(self.forceN, magnitude, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("forceN, vektör kuvvetin büyüklüğüne eşit olmalı.")
        if self.forceApplicationPointVehicleM is not None and (
            self.studioTransfer is None or self.forceComponentsN is None
        ):
            raise ValueError("Studio kuvvet uygulama noktası CAD çerçevesi ve vektör gerektirir.")
        if self.fixedNamedSelection == self.forceNamedSelection:
            raise ValueError("Mesnet ve kuvvet için farklı named selection gerekir.")
        sizes = self.meshConvergenceSizesMm
        if sizes is not None:
            if any(not math.isfinite(size) or size < 0.1 or size > 1_000 for size in sizes):
                raise ValueError("Yakınsama mesh boyutları 0,1–1000 mm aralığında olmalı.")
            if not (sizes[0] > sizes[1] > sizes[2] == self.meshSizeMm):
                raise ValueError(
                    "Üç mesh boyutu azalan sırada olmalı; sonuncusu ana mesh boyutu olmalı."
                )
        return self


class MeshConvergencePoint(BaseModel):
    meshSizeMm: float
    meshNodes: int
    meshElements: int
    maximumVonMisesStressPa: float
    maximumTotalDeformationM: float
    solverStatus: Literal["Done"] = "Done"
    resultFileBytes: int = Field(default=0, ge=0)
    warnings: list[str] = Field(default_factory=list)


class MeshQualityEvidence(BaseModel):
    status: Literal["MEASURED_BY_MECHANICAL", "UNAVAILABLE"]
    metric: Literal["ElementQuality"] = "ElementQuality"
    minimum: float | None = None
    average: float | None = None
    maximum: float | None = None


class MeshConvergenceAssessment(BaseModel):
    status: Literal["PASSED_NUMERICALLY", "NOT_CONVERGED"]
    toleranceRelative: float
    coarseToMediumStressChangeRelative: float
    coarseToMediumDeformationChangeRelative: float
    stressChangeRelative: float
    deformationChangeRelative: float
    meshCountsIncrease: bool
    points: list[MeshConvergencePoint]


class StaticAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    solverStatus: str
    maximumVonMisesStressPa: float
    maximumTotalDeformationM: float
    meshNodes: int
    meshElements: int
    resultFileBytes: int = Field(default=0, ge=0)
    geometrySha256: str
    material: str
    fixedNamedSelection: str
    forceNamedSelection: str
    forceAxis: Literal["X", "Y", "Z"]
    forceN: float
    forceComponentsN: Vector3 | None = None
    forceInputSha256: str | None = None
    forceApplicationPointVehicleM: Vector3 | None = None
    bodyCount: int = Field(default=0, ge=0)
    fixedScopeEntityCount: int = Field(default=0, ge=0)
    forceScopeEntityCount: int = Field(default=0, ge=0)
    meshSizeMm: float
    mechanicalVersion: str
    productInfo: str
    units: Literal["SI"] = "SI"
    validationStatus: Literal["NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"] = (
        "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
    )
    shapeCheckInSolverInput: bool = False
    meshConvergence: MeshConvergenceAssessment | None = None
    meshQuality: MeshQualityEvidence = Field(
        default_factory=lambda: MeshQualityEvidence(status="UNAVAILABLE")
    )
    studioTransfer: StudioTransferEvidence | None = None
    warnings: list[str] = Field(default_factory=list)


class StaticJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    state: Literal["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]
    stage: AnalysisStage
    message: str
    startedAt: str
    completedAt: str | None = None
    errorCode: str | None = None
    result: StaticAnalysisResult | None = None


class AnalysisError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class OwnedMechanical(Protocol):
    def run_with_owned_client(self, action: Callable[[MechanicalClient], _T]) -> _T: ...


def _validated_geometry(raw_path: str) -> tuple[Path, str]:
    path = Path(raw_path)
    if not path.is_absolute() or str(path).startswith("\\\\"):
        raise AnalysisError(
            "LOCAL_CAD_PATH_REQUIRED", "CAD yolu mutlak ve bu bilgisayarda yerel olmalı."
        )
    try:
        resolved = path.resolve(strict=True)
        if str(resolved).startswith("\\\\"):
            raise AnalysisError("LOCAL_CAD_PATH_REQUIRED", "Ağdaki CAD dosyaları desteklenmiyor.")
        if not resolved.is_file() or resolved.suffix.lower() not in SUPPORTED_CAD_SUFFIXES:
            raise AnalysisError(
                "UNSUPPORTED_CAD_FILE", "Var olan bir AGDB, PMDB veya STEP CAD dosyası seçin."
            )
        if resolved.stat().st_size > 100 * 1024 * 1024:
            raise AnalysisError("CAD_FILE_TOO_LARGE", "CAD dosyası 100 MB sınırını aşıyor.")
        with resolved.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
    except AnalysisError:
        raise
    except OSError as exc:
        raise AnalysisError("CAD_FILE_UNREADABLE", "Yerel CAD dosyası okunamadı.") from exc
    return resolved, digest


def _payload(raw: str, stage: str) -> dict[str, object]:
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise AnalysisError(
            "MECHANICAL_RESPONSE_INVALID", f"{stage} aşaması geçerli JSON döndürmedi."
        ) from exc
    if not isinstance(value, dict):
        raise AnalysisError("MECHANICAL_RESPONSE_INVALID", f"{stage} aşaması nesne döndürmedi.")
    return value


def _count(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise AnalysisError("MESH_COUNT_INVALID", f"Mechanical geçerli {label} sayısı döndürmedi.")
    return value


def _si_quantity(value: object, expected_unit: str) -> float:
    if not isinstance(value, str):
        raise AnalysisError("RESULT_QUANTITY_INVALID", "Mechanical sonuç birimi eksik.")
    match = _QUANTITY.fullmatch(value)
    if match is None or match.group(2).strip() != expected_unit:
        raise AnalysisError(
            "RESULT_UNIT_UNEXPECTED",
            f"Mechanical sonucu beklenen [{expected_unit}] biriminde değil.",
        )
    numeric = float(match.group(1))
    if not math.isfinite(numeric) or numeric < 0:
        raise AnalysisError(
            "RESULT_VALUE_INVALID", "Mechanical negatif veya sonlu olmayan sonuç döndürdü."
        )
    return numeric


def _mesh_quality(client: MechanicalClient) -> MeshQualityEvidence:
    """Read Mechanical's dimensionless element-quality metric; never synthesize it."""
    try:
        payload = _payload(
            client.run_python_script(
                "MSKU_METRIC = Ansys.Mechanical.DataModel.Enums.MeshMetricType.ElementQuality\n"
                "Model.Mesh.MeshMetric = MSKU_METRIC\n"
                "Model.Mesh.ComputeMeshQualityMetrics()\n"
                "import json\njson.dumps({'minimum': str(Model.Mesh.Minimum), "
                "'average': str(Model.Mesh.Average), 'maximum': str(Model.Mesh.Maximum)})"
            ),
            "mesh quality",
        )
        values = []
        for key in ("minimum", "average", "maximum"):
            raw = payload.get(key)
            if not isinstance(raw, str):
                raise ValueError("missing metric")
            numeric = float(raw.split()[0])
            if not math.isfinite(numeric) or not 0 <= numeric <= 1:
                raise ValueError("invalid element quality")
            values.append(numeric)
        if not values[0] <= values[1] <= values[2]:
            raise ValueError("invalid metric ordering")
        return MeshQualityEvidence(
            status="MEASURED_BY_MECHANICAL",
            minimum=values[0],
            average=values[1],
            maximum=values[2],
        )
    except Exception:
        # API availability differs by Mechanical release/mesh type. Report unavailable.
        return MeshQualityEvidence(status="UNAVAILABLE")


def _solver_failure(working_dir: Path | None, solver_status: str) -> AnalysisError:
    """Classify local solver logs without returning paths or license details to HTTP clients."""
    try:
        if working_dir is None or not working_dir.is_absolute():
            raise ValueError("Mechanical did not return an absolute working directory")
        excerpts: list[str] = []
        for name in ("solve.out", "file0.err"):
            candidate = working_dir / name
            if candidate.is_file():
                with candidate.open("r", errors="replace") as source:
                    excerpts.append(source.read(262_144).casefold())
        output = "\n".join(excerpts)
    except Exception:  # Mechanical RPC can fail after solve; never expose raw log details.
        output = ""
    if "insufficient hpc licenses" in output or "insufficient flexnet publisher" in output:
        return AnalysisError(
            "ANSYS_HPC_LICENSE_LIMIT",
            "Mechanical çözümü için istenen çekirdek sayısı mevcut HPC lisansını aşıyor.",
        )
    if "element option solid186" in output and "appropriate product" in output:
        return AnalysisError(
            "ANSYS_STRUCTURAL_PRODUCT_UNAVAILABLE",
            "Mechanical solver, SOLID186 için uygun yapısal ürün yetkisini bulamadı. "
            "Yerel ANSYS lisans/ürün seçimini kontrol edin.",
        )
    return AnalysisError(
        "SOLVER_NOT_DONE",
        "Mechanical çözümü başarıyla tamamlanmadı: " + solver_status[:80],
    )


def _solver_warning_summary(working_dir: Path) -> list[str]:
    """Surface known engineering risks without exposing raw local solver logs."""
    warnings: list[str] = []
    try:
        with (working_dir / "solve.out").open("rb") as source:
            source.seek(0, os.SEEK_END)
            source.seek(max(0, source.tell() - 65_536))
            tail = source.read().decode("utf-8", errors="replace")
        match = re.search(r"NUMBER OF WARNING MESSAGES ENCOUNTERED\s*=\s*(\d+)", tail)
        if match and int(match.group(1)) > 0:
            warnings.append(
                f"MAPDL {int(match.group(1))} uyarı bildirdi; yerel solve.out/file0.err "
                "dosyalarını mühendislik kullanımından önce inceleyin."
            )
    except OSError:
        pass
    try:
        with (working_dir / "file0.err").open("r", errors="replace") as source:
            error_log = source.read(262_144).casefold()
        if "element shape checking is currently inactive" in error_log:
            warnings.append(
                "MAPDL: eleman şekil denetimi kapalı; mesh kalitesi henüz doğrulanmadı."
            )
        if "reduced integration brick" in error_log and "pcg solver" in error_log:
            warnings.append(
                "MAPDL: azaltılmış integrasyonlu brick elemanlar PCG ile kullanıldı; "
                "kalınlık boyunca mesh ve yakınsama henüz doğrulanmadı."
            )
        if re.search(
            r"material number\s+\d+.*?should normally have at least\s+one mp or one tb",
            error_log,
            re.DOTALL,
        ):
            warnings.append(
                "MAPDL: bir elemanın malzeme tanımı MP/TB içermiyor; malzemeye göre enerji "
                "çıktısı güvenilir olmayabilir. Eleman tipini yerel ds.dat üzerinden denetleyin."
            )
    except OSError:
        pass
    return warnings


def _shape_check_in_solver_input(working_dir: Path) -> bool:
    """Confirm that the submitted APDL input contains both documented checks."""
    try:
        with (working_dir / "ds.dat").open("r", errors="replace") as source:
            solver_input = source.read(2_000_000).upper()
    except OSError:
        return False
    return "SHPP,ON,ALL" in solver_input and re.search(r"(?m)^CHECK\s*$", solver_input) is not None


def _relative_change(previous: float, current: float) -> float:
    if current == 0:
        if previous != 0:
            raise AnalysisError(
                "MESH_CHANGE_UNDEFINED",
                "İnce mesh sonucu sıfır; göreli yakınsama farkı hesaplanamadı.",
            )
        return 0.0
    return abs(current - previous) / abs(current)


def _assess_mesh_convergence(points: list[MeshConvergencePoint]) -> MeshConvergenceAssessment:
    if len(points) != 3:
        raise AnalysisError("MESH_STUDY_INCOMPLETE", "Üç gerçek mesh çözümü tamamlanmadı.")
    coarse, middle, fine = points
    coarse_stress_change = _relative_change(
        coarse.maximumVonMisesStressPa, middle.maximumVonMisesStressPa
    )
    coarse_deformation_change = _relative_change(
        coarse.maximumTotalDeformationM, middle.maximumTotalDeformationM
    )
    stress_change = _relative_change(middle.maximumVonMisesStressPa, fine.maximumVonMisesStressPa)
    deformation_change = _relative_change(
        middle.maximumTotalDeformationM, fine.maximumTotalDeformationM
    )
    counts_increase = all(
        left.meshElements < right.meshElements and left.meshNodes < right.meshNodes
        for left, right in zip(points[:-1], points[1:], strict=True)
    )
    passed = (
        counts_increase
        and stress_change <= MESH_CONVERGENCE_TOLERANCE_RELATIVE
        and deformation_change <= MESH_CONVERGENCE_TOLERANCE_RELATIVE
        and stress_change <= coarse_stress_change
        and deformation_change <= coarse_deformation_change
    )
    return MeshConvergenceAssessment(
        status="PASSED_NUMERICALLY" if passed else "NOT_CONVERGED",
        toleranceRelative=MESH_CONVERGENCE_TOLERANCE_RELATIVE,
        coarseToMediumStressChangeRelative=coarse_stress_change,
        coarseToMediumDeformationChangeRelative=coarse_deformation_change,
        stressChangeRelative=stress_change,
        deformationChangeRelative=deformation_change,
        meshCountsIncrease=counts_increase,
        points=points,
    )


def _ascii_project_path() -> str:
    """Choose a local ASCII project path; Mechanical v261 failed post-solve on Unicode paths."""
    configured = os.getenv("MSKU_ANSYS_PROJECT_DIRECTORY", "").strip()
    directory = configured or tempfile.gettempdir()
    if not configured and os.name == "nt":
        try:
            function = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW  # type: ignore[attr-defined]
            function.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
            function.restype = ctypes.c_uint32
            length = function(directory, None, 0)
            if length:
                buffer = ctypes.create_unicode_buffer(length + 1)
                if 0 < function(directory, buffer, len(buffer)) < len(buffer):
                    directory = buffer.value
        except (AttributeError, OSError):
            pass
    root = Path(directory)
    if (
        not directory.isascii()
        or not root.is_absolute()
        or directory.startswith("\\\\")
        or not root.is_dir()
    ):
        raise AnalysisError(
            "ANSYS_ASCII_PROJECT_DIRECTORY_REQUIRED",
            "Mechanical için var olan, yerel ve yalnızca ASCII karakterli bir proje dizini "
            "gerekli. MSKU_ANSYS_PROJECT_DIRECTORY ayarını kontrol edin.",
        )
    return str(root / f"msku_ansys_{uuid4().hex}.mechdb")


def _setup_script(request: StaticAnalysisRequest, path: Path) -> str:
    # repr() produces quoted Python literals, never executable user-supplied source.
    if request.forceComponentsN is None:
        force_script = (
            f"MSKU_FORCE.{request.forceAxis}Component.Output.DiscreteValues = "
            f'[Quantity({request.forceN!r}, "N")]'
        )
    else:
        components = request.forceComponentsN
        force_script = "\n".join(
            f'MSKU_FORCE.{axis}Component.Output.DiscreteValues = [Quantity({value!r}, "N")]'
            for axis, value in zip("XYZ", components.components(), strict=True)
        )
    studio_points = (
        {
            key: point.components()
            for key, point in transfer_evidence(request.studioTransfer).hardpointsCadMm.items()
        }
        if request.studioTransfer is not None
        else {}
    )
    return f"""
import json
ExtAPI.Application.ActiveUnitSystem = MechanicalUnitSystem.StandardMKS
MSKU_STUDIO_HARDPOINTS_CAD_MM = {studio_points!r}
MSKU_IMPORT = Model.GeometryImportGroup.AddGeometryImport()
MSKU_PREF = Ansys.ACT.Mechanical.Utilities.GeometryImportPreferences()
MSKU_PREF.ProcessNamedSelections = True
MSKU_FORMAT = Ansys.Mechanical.DataModel.Enums.GeometryImportPreference.Format.Automatic
MSKU_IMPORT.Import({str(path)!r}, MSKU_FORMAT, MSKU_PREF)
MSKU_BODY_CATEGORY = Ansys.Mechanical.DataModel.Enums.DataModelObjectCategory.Body
MSKU_BODIES = Model.Geometry.GetChildren(MSKU_BODY_CATEGORY, True)
if not MSKU_BODIES:
    raise RuntimeError("MSKU_NO_GEOMETRY_BODIES")
MSKU_NAMES = list(Model.NamedSelections.Children)
MSKU_FIXED = [x for x in MSKU_NAMES if x.Name == {request.fixedNamedSelection!r}]
MSKU_FORCE_SCOPE = [x for x in MSKU_NAMES if x.Name == {request.forceNamedSelection!r}]
if len(MSKU_FIXED) != 1 or not MSKU_FIXED[0].Ids:
    raise RuntimeError("MSKU_FIXED_SELECTION_MISSING_OR_EMPTY:" +
                       ",".join(x.Name for x in MSKU_NAMES))
if len(MSKU_FORCE_SCOPE) != 1 or not MSKU_FORCE_SCOPE[0].Ids:
    raise RuntimeError("MSKU_FORCE_SELECTION_MISSING_OR_EMPTY:" +
                       ",".join(x.Name for x in MSKU_NAMES))
if set(MSKU_FIXED[0].Ids).intersection(set(MSKU_FORCE_SCOPE[0].Ids)):
    raise RuntimeError("MSKU_SUPPORT_FORCE_SCOPE_OVERLAP")
MSKU_MATERIAL = Model.Materials.AddMaterialAssignment()
MSKU_MATERIAL.Material = {request.material!r}
MSKU_GEOMETRY_ENTITIES = Ansys.ACT.Interfaces.Common.SelectionTypeEnum.GeometryEntities
MSKU_SELECTION = ExtAPI.SelectionManager.CreateSelectionInfo(MSKU_GEOMETRY_ENTITIES)
MSKU_SELECTION.Ids = [body.GetGeoBody().Id for body in MSKU_BODIES]
MSKU_MATERIAL.Location = MSKU_SELECTION
MSKU_ANALYSIS = Model.AddStaticStructuralAnalysis()
MSKU_ANALYSIS.AnalysisSettings.SolverType = SolverType.Direct
if str(MSKU_ANALYSIS.AnalysisSettings.SolverType).split('.')[-1] != 'Direct':
    raise RuntimeError('MSKU_DIRECT_SOLVER_NOT_CONFIRMED')
MSKU_SHAPE_CHECK = MSKU_ANALYSIS.AddCommandSnippet()
MSKU_SHAPE_CHECK.Input = '/PREP7\\nSHPP,ON,ALL\\nCHECK\\n/SOLU'
MSKU_SUPPORT = MSKU_ANALYSIS.AddFixedSupport()
MSKU_SUPPORT.Location = MSKU_FIXED[0]
MSKU_FORCE = MSKU_ANALYSIS.AddForce()
MSKU_FORCE.Location = MSKU_FORCE_SCOPE[0]
MSKU_FORCE.DefineBy = LoadDefineBy.Components
{force_script}
MSKU_DEFORMATION = MSKU_ANALYSIS.Solution.AddTotalDeformation()
MSKU_STRESS = MSKU_ANALYSIS.Solution.AddEquivalentStress()
json.dumps({{"bodies": len(MSKU_BODIES), "fixedFaces": len(MSKU_FIXED[0].Ids),
            "forceFaces": len(MSKU_FORCE_SCOPE[0].Ids),
            "studioHardpoints": len(MSKU_STUDIO_HARDPOINTS_CAD_MM),
            "solverType": str(MSKU_ANALYSIS.AnalysisSettings.SolverType)}})
""".strip()


def run_static_structural(
    client: MechanicalClient,
    request: StaticAnalysisRequest,
    progress: Callable[[AnalysisStage, str], None],
) -> StaticAnalysisResult:
    path, digest = _validated_geometry(request.geometryPath)
    progress("importing", "CAD içe aktarılıyor ve named selection kapsamları doğrulanıyor.")
    # Only a bridge-owned blank session reaches this function. Each new explicit run
    # starts a fresh Mechanical project rather than inheriting stale loads/results.
    client.clear()
    setup = _payload(client.run_python_script(_setup_script(request, path)), "CAD ve yük")
    body_count = _count(setup.get("bodies"), "gövde")
    fixed_count = _count(setup.get("fixedFaces"), "mesnet yüzeyi")
    force_count = _count(setup.get("forceFaces"), "kuvvet yüzeyi")
    if request.studioTransfer is not None and setup.get("studioHardpoints") != 9:
        raise AnalysisError(
            "STUDIO_TRANSFER_NOT_CONFIRMED",
            "Studio hardpoint koordinatları Mechanical oturumuna aktarılmadı.",
        )
    if str(setup.get("solverType", "")).split(".")[-1] != "Direct":
        raise AnalysisError(
            "DIRECT_SOLVER_NOT_CONFIRMED",
            "Sparse/Direct çözücü ayarı doğrulanamadı; çözüm başlatılmadı.",
        )

    configured_cores = str(
        client.run_python_script(
            "MSKU_SOLVE_CONFIG = ExtAPI.Application.SolveConfigurations['My Computer']\n"
            "MSKU_SOLVE_CONFIG.SetAsDefault()\n"
            "MSKU_SOLVE_CONFIG.SolveProcessSettings.MaxNumberOfCores = "
            f"{STUDENT_SAFE_SOLVE_CORES}\n"
            "str(MSKU_SOLVE_CONFIG.SolveProcessSettings.MaxNumberOfCores)"
        )
    ).strip()
    if configured_cores != str(STUDENT_SAFE_SOLVE_CORES):
        raise AnalysisError(
            "SOLVE_CORE_CONFIGURATION_FAILED",
            "Mechanical çözüm çekirdeği sınırı doğrulanamadı; solve başlatılmadı.",
        )

    # This documented standalone Mechanical API relocates the solver project.
    # On the tested v261 Windows installation a Unicode profile path yielded
    # an "unknown error"/partial status despite MAPDL completing. A fresh
    # ASCII path made the same model report Done; never reinterpret partial as Done.
    project_path = _ascii_project_path()
    try:
        client.run_python_script(
            "ExtAPI.DataModel.Project.SaveAs(" + repr(project_path) + ", False)"
        )
    except Exception as exc:
        raise AnalysisError(
            "ANSYS_PROJECT_SAVE_FAILED",
            "Mechanical analizi ASCII proje dizinine kaydedilemedi; çözüm başlatılmadı.",
        ) from exc

    try:
        working_dir_value = client.run_python_script("MSKU_ANALYSIS.WorkingDir")
        working_dir = Path(working_dir_value) if working_dir_value else None
    except Exception:
        working_dir = None
    if working_dir is None or not working_dir.is_absolute() or not str(working_dir).isascii():
        raise AnalysisError(
            "ANSYS_ASCII_WORKDIR_NOT_CONFIRMED",
            "Mechanical çözüm çalışma dizini ASCII olarak doğrulanamadı; çözüm başlatılmadı.",
        )

    sizes = request.meshConvergenceSizesMm or [request.meshSizeMm]
    points: list[MeshConvergencePoint] = []
    mesh_quality = MeshQualityEvidence(status="UNAVAILABLE")
    for index, size in enumerate(sizes):
        progress(
            "meshing",
            f"Mechanical mesh {index + 1}/{len(sizes)} üretiyor; Student sınırı denetleniyor.",
        )
        clear = "Model.Mesh.ClearGeneratedData()\n" if index else ""
        mesh = _payload(
            client.run_python_script(
                clear + "Model.Mesh.ElementSize = Quantity(" + repr(size) + ", 'mm')\n"
                "Model.Mesh.GenerateMesh()\n"
                "import json\njson.dumps({'nodes': int(Model.Mesh.Nodes), "
                "'elements': int(Model.Mesh.Elements)})"
            ),
            "mesh",
        )
        nodes = _count(mesh.get("nodes"), "düğüm")
        elements = _count(mesh.get("elements"), "eleman")
        if nodes > STUDENT_MESH_PRECHECK_LIMIT or elements > STUDENT_MESH_PRECHECK_LIMIT:
            raise AnalysisError(
                "STUDENT_MESH_LIMIT_PRECHECK",
                "Mesh 128.000 düğüm/eleman ön kontrolünü aştı; solve başlatılmadı.",
            )
        if index == len(sizes) - 1:
            mesh_quality = _mesh_quality(client)

        progress("solving", f"Static Structural çözümü {index + 1}/{len(sizes)} çalışıyor.")
        solved = _payload(
            client.run_python_script(
                "MSKU_ANALYSIS.Solution.Solve(True)\n"
                "import json\njson.dumps({'status': str(MSKU_ANALYSIS.Solution.Status)})"
            ),
            "solve",
        )
        solver_status = str(solved.get("status", ""))
        if solver_status.split(".")[-1] != "Done":
            raise _solver_failure(working_dir, solver_status)
        result_file = working_dir / "file.rst"
        if not result_file.is_file() or result_file.stat().st_size == 0:
            raise AnalysisError(
                "STATIC_RESULT_FILE_MISSING",
                "Mechanical Done bildirdi ancak statik sonuç dosyası eksik veya boş.",
            )
        result_file_bytes = result_file.stat().st_size

        progress("extracting", f"Gerilme ve deformasyon {index + 1}/{len(sizes)} okunuyor.")
        results = _payload(
            client.run_python_script(
                "MSKU_ANALYSIS.Solution.EvaluateAllResults()\n"
                "import json\njson.dumps({'stress': str(MSKU_STRESS.Maximum), "
                "'deformation': str(MSKU_DEFORMATION.Maximum), "
                "'status': str(MSKU_ANALYSIS.Solution.Status)})"
            ),
            "sonuç",
        )
        if str(results.get("status", "")).split(".")[-1] != "Done":
            raise AnalysisError(
                "SOLVER_STATUS_CHANGED", "Sonuç alınırken Mechanical çözüm durumu değişti."
            )
        step_warnings = _solver_warning_summary(working_dir)
        if any("PCG ile kullanıldı" in warning for warning in step_warnings):
            raise AnalysisError(
                "DIRECT_SOLVER_NOT_USED",
                "MAPDL Direct/Sparse yerine PCG kullandı; sonuç kabul edilmedi.",
            )
        points.append(
            MeshConvergencePoint(
                meshSizeMm=size,
                meshNodes=nodes,
                meshElements=elements,
                maximumVonMisesStressPa=_si_quantity(results.get("stress"), "Pa"),
                maximumTotalDeformationM=_si_quantity(results.get("deformation"), "m"),
                resultFileBytes=result_file_bytes,
                warnings=step_warnings,
            )
        )

    final = points[-1]
    convergence = _assess_mesh_convergence(points) if request.meshConvergenceSizesMm else None
    shape_check_in_input = _shape_check_in_solver_input(working_dir)
    warnings = [
        "Sonuç yalnızca sayısal çözüm kanıtıdır; fiziksel korelasyon değildir.",
        "Student lisans sınırı solve sırasında eklenen elemanları da kapsayabilir.",
    ]
    if convergence is None:
        warnings.append("Mesh yakınsaması çalıştırılmadı; sonuç mesh-bağımsızlığı göstermez.")
    elif convergence.status != "PASSED_NUMERICALLY":
        warnings.append("Üç kademeli mesh çalışması sayısal yakınsama ölçütünü karşılamadı.")
    else:
        warnings.append(
            "Üç kademeli mesh çalışması yalnızca seçilen küresel çıktılar için sayısal "
            "ölçütü karşıladı; yerel gerilme tekillikleri ve fiziksel geçerlilik ayrıca "
            "incelenmeli."
        )
    warnings.extend(dict.fromkeys(warning for point in points for warning in point.warnings))
    if not shape_check_in_input:
        warnings.append(
            "APDL şekil denetimi solver girdisinde doğrulanamadı; mesh kalitesi belirsiz."
        )
    if mesh_quality.status == "UNAVAILABLE":
        warnings.append("Mechanical eleman kalite metriği okunamadı; mesh kalitesi bilinmiyor.")
    if request.studioTransfer is not None:
        warnings.append(
            "Studio hardpointleri Mechanical oturumuna izleme verisi olarak aktarıldı; "
            "CAD topolojisine veya yük/mesnet yüzeylerine otomatik bağlanmadı. "
            "CAD anchor eşleşmesi kullanıcı beyanıdır, fiziksel doğrulama değildir."
        )
        if request.studioTransfer.dataClassification == "demonstration":
            warnings.append("DEMO/SYNTHETIC Studio geometrisi gerçek araç CAD verisi değildir.")
    if request.forceComponentsN is not None:
        warnings.append(
            "Studio kuvvet vektörü CAD named face üzerine uygulandı; bildirilen uygulama "
            "noktası ve moment otomatik aktarılmadı. Fiziksel yük yolu ayrıca doğrulanmalı."
        )
    warnings.append("Structural Steel ANSYS kütüphane malzemesidir; takım ölçümü değildir.")
    return StaticAnalysisResult(
        solverStatus=solver_status,
        maximumVonMisesStressPa=final.maximumVonMisesStressPa,
        maximumTotalDeformationM=final.maximumTotalDeformationM,
        meshNodes=final.meshNodes,
        meshElements=final.meshElements,
        resultFileBytes=final.resultFileBytes,
        geometrySha256=digest,
        material=request.material,
        fixedNamedSelection=request.fixedNamedSelection,
        forceNamedSelection=request.forceNamedSelection,
        forceAxis=request.forceAxis,
        forceN=request.forceN,
        forceComponentsN=request.forceComponentsN,
        forceInputSha256=request.forceInputSha256,
        forceApplicationPointVehicleM=request.forceApplicationPointVehicleM,
        bodyCount=body_count,
        fixedScopeEntityCount=fixed_count,
        forceScopeEntityCount=force_count,
        meshSizeMm=request.meshSizeMm,
        mechanicalVersion=str(client.version),
        productInfo=str(client.get_product_info())[:500],
        shapeCheckInSolverInput=shape_check_in_input,
        meshConvergence=convergence,
        meshQuality=mesh_quality,
        studioTransfer=(
            transfer_evidence(request.studioTransfer)
            if request.studioTransfer is not None
            else None
        ),
        warnings=warnings,
    )


class StaticAnalysisManager:
    def __init__(self, adapter: OwnedMechanical) -> None:
        self._adapter = adapter
        self._lock = threading.Lock()
        self._job: StaticJobResponse | None = None
        self._request: StaticAnalysisRequest | None = None

    def start(self, request: StaticAnalysisRequest) -> StaticJobResponse:
        _validated_geometry(request.geometryPath)
        with self._lock:
            if self._job and self._job.state in {"QUEUED", "RUNNING"}:
                raise AnalysisError(
                    "ANALYSIS_ALREADY_RUNNING", "Bir Structural analizi zaten çalışıyor."
                )
            self._job = StaticJobResponse(
                jobId=str(uuid4()),
                state="QUEUED",
                stage="queued",
                message="Açık kullanıcı isteği alındı; yerel Mechanical oturumu bekleniyor.",
                startedAt=datetime.now(UTC).isoformat(),
            )
            self._request = request.model_copy(deep=True)
            job = self._job.model_copy(deep=True)
        threading.Thread(target=self._work, args=(request,), daemon=False).start()
        return job

    def snapshot(self, job_id: str) -> StaticJobResponse | None:
        with self._lock:
            if self._job is None or self._job.jobId != job_id:
                return None
            return self._job.model_copy(deep=True)

    def report_source(self, job_id: str) -> tuple[StaticAnalysisRequest, StaticJobResponse] | None:
        with self._lock:
            if (
                self._job is None
                or self._job.jobId != job_id
                or self._job.state != "SUCCEEDED"
                or self._job.result is None
                or self._request is None
            ):
                return None
            return self._request.model_copy(deep=True), self._job.model_copy(deep=True)

    def _progress(self, stage: AnalysisStage, message: str) -> None:
        with self._lock:
            if self._job is not None:
                self._job.state = "RUNNING"
                self._job.stage = stage
                self._job.message = message

    def _work(self, request: StaticAnalysisRequest) -> None:
        try:
            result = self._adapter.run_with_owned_client(
                lambda client: run_static_structural(client, request, self._progress)
            )
        except AnalysisError as exc:
            self._finish("FAILED", exc.code, exc.message, None)
        except Exception as exc:
            # Raw gRPC/Mechanical errors may contain local paths or license-server secrets.
            lowered = f"{type(exc).__name__} {exc}".casefold()
            known_failures = (
                (
                    "msku_fixed_selection_missing_or_empty",
                    "FIXED_SELECTION_MISSING",
                    "CAD içindeki sabit mesnet named selection bulunamadı veya boş.",
                ),
                (
                    "msku_force_selection_missing_or_empty",
                    "FORCE_SELECTION_MISSING",
                    "CAD içindeki kuvvet named selection bulunamadı veya boş.",
                ),
                (
                    "msku_support_force_scope_overlap",
                    "BOUNDARY_SCOPE_OVERLAP",
                    "Sabit mesnet ve kuvvet seçimleri aynı geometriyi kapsıyor.",
                ),
                (
                    "msku_no_geometry_bodies",
                    "CAD_IMPORT_EMPTY",
                    "CAD içe aktarıldı ancak katı gövde bulunamadı.",
                ),
                ("license", "ANSYS_LICENSE_ERROR", "Mechanical lisansı çözüme izin vermedi."),
                (
                    "material",
                    "MATERIAL_NOT_AVAILABLE",
                    "Structural Steel malzemesi Mechanical içinde atanamadı; "
                    "yerel malzeme kütüphanesini kontrol edin.",
                ),
            )
            match = next((item for item in known_failures if item[0] in lowered), None)
            code = match[1] if match else "MECHANICAL_ANALYSIS_FAILED"
            message = (
                match[2]
                if match
                else "Mechanical analizi başarısız oldu. Yerel Mechanical solve "
                "günlüklerini kontrol edin."
            )
            self._finish(
                "FAILED",
                code,
                message,
                None,
            )
        else:
            self._finish("SUCCEEDED", None, "Mechanical çözümü ve sonuçları doğrulandı.", result)

    def _finish(
        self,
        state: Literal["SUCCEEDED", "FAILED"],
        error_code: str | None,
        message: str,
        result: StaticAnalysisResult | None,
    ) -> None:
        with self._lock:
            if self._job is not None:
                self._job.state = state
                self._job.stage = "done"
                self._job.message = message
                self._job.errorCode = error_code
                self._job.result = result
                self._job.completedAt = datetime.now(UTC).isoformat()
