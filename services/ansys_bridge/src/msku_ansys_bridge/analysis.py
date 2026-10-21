"""Explicit, local-only Static Structural jobs; no synthetic engineering results."""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .adapter import MechanicalClient

_T = TypeVar("_T")
AnalysisStage = Literal["queued", "importing", "meshing", "solving", "extracting", "done"]
SUPPORTED_CAD_SUFFIXES = frozenset({".agdb", ".pmdb", ".step", ".stp"})
# Published Student structural limit is 128K nodes/elements. Mesh counts can undercount
# solver-generated entities, so this is a preflight rejection, not a license guarantee.
STUDENT_MESH_PRECHECK_LIMIT = 128_000
# Student's included solver entitlement allowed two cores on the tested v261 install.
# A lower core count is a solve-process setting, not a substitute for a solver license.
STUDENT_SAFE_SOLVE_CORES = 2
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
    meshSizeMm: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)

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
        if self.forceN == 0:
            raise ValueError("Kuvvet sıfır olamaz.")
        if self.fixedNamedSelection == self.forceNamedSelection:
            raise ValueError("Mesnet ve kuvvet için farklı named selection gerekir.")
        return self


class StaticAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    solverStatus: str
    maximumVonMisesStressPa: float
    maximumTotalDeformationM: float
    meshNodes: int
    meshElements: int
    geometrySha256: str
    material: str
    fixedNamedSelection: str
    forceNamedSelection: str
    forceAxis: Literal["X", "Y", "Z"]
    forceN: float
    meshSizeMm: float
    mechanicalVersion: str
    productInfo: str
    units: Literal["SI"] = "SI"
    validationStatus: Literal["NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"] = (
        "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
    )
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


def _solver_failure(client: MechanicalClient, solver_status: str) -> AnalysisError:
    """Classify local solver logs without returning paths or license details to HTTP clients."""
    try:
        working_dir = Path(str(client.run_python_script("str(MSKU_ANALYSIS.WorkingDir)")))
        if not working_dir.is_absolute():
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


def _setup_script(request: StaticAnalysisRequest, path: Path) -> str:
    # repr() produces quoted Python literals, never executable user-supplied source.
    return f"""
import json
ExtAPI.Application.ActiveUnitSystem = MechanicalUnitSystem.StandardMKS
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
MSKU_SUPPORT = MSKU_ANALYSIS.AddFixedSupport()
MSKU_SUPPORT.Location = MSKU_FIXED[0]
MSKU_FORCE = MSKU_ANALYSIS.AddForce()
MSKU_FORCE.Location = MSKU_FORCE_SCOPE[0]
MSKU_FORCE.DefineBy = LoadDefineBy.Components
MSKU_FORCE.{request.forceAxis}Component.Output.DiscreteValues = [Quantity({request.forceN!r}, "N")]
MSKU_DEFORMATION = MSKU_ANALYSIS.Solution.AddTotalDeformation()
MSKU_STRESS = MSKU_ANALYSIS.Solution.AddEquivalentStress()
json.dumps({{"bodies": len(MSKU_BODIES), "fixedFaces": len(MSKU_FIXED[0].Ids),
            "forceFaces": len(MSKU_FORCE_SCOPE[0].Ids)}})
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
    _count(setup.get("bodies"), "gövde")
    _count(setup.get("fixedFaces"), "mesnet yüzeyi")
    _count(setup.get("forceFaces"), "kuvvet yüzeyi")

    progress("meshing", "Mechanical ağı üretiyor; Student boyut ön kontrolü yapılacak.")
    mesh = _payload(
        client.run_python_script(
            "Model.Mesh.ElementSize = Quantity(" + repr(request.meshSizeMm) + ", 'mm')\n"
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

    progress("solving", "Static Structural çözümü gerçek Mechanical prosesinde çalışıyor.")
    solved = _payload(
        client.run_python_script(
            "MSKU_ANALYSIS.Solution.Solve(True)\n"
            "import json\njson.dumps({'status': str(MSKU_ANALYSIS.Solution.Status)})"
        ),
        "solve",
    )
    solver_status = str(solved.get("status", ""))
    if solver_status.split(".")[-1] != "Done":
        raise _solver_failure(client, solver_status)

    progress("extracting", "Gerçek von Mises gerilmesi ve toplam deformasyon okunuyor.")
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
    stress_pa = _si_quantity(results.get("stress"), "Pa")
    deformation_m = _si_quantity(results.get("deformation"), "m")
    return StaticAnalysisResult(
        solverStatus=solver_status,
        maximumVonMisesStressPa=stress_pa,
        maximumTotalDeformationM=deformation_m,
        meshNodes=nodes,
        meshElements=elements,
        geometrySha256=digest,
        material=request.material,
        fixedNamedSelection=request.fixedNamedSelection,
        forceNamedSelection=request.forceNamedSelection,
        forceAxis=request.forceAxis,
        forceN=request.forceN,
        meshSizeMm=request.meshSizeMm,
        mechanicalVersion=str(client.version),
        productInfo=str(client.get_product_info())[:500],
        warnings=[
            "Sonuç yalnızca sayısal çözüm kanıtıdır; fiziksel korelasyon "
            "veya mesh yakınsaması değildir.",
            "Student lisans sınırı solve sırasında eklenen elemanları da kapsayabilir.",
        ],
    )


class StaticAnalysisManager:
    def __init__(self, adapter: OwnedMechanical) -> None:
        self._adapter = adapter
        self._lock = threading.Lock()
        self._job: StaticJobResponse | None = None

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
            job = self._job.model_copy(deep=True)
        threading.Thread(target=self._work, args=(request,), daemon=False).start()
        return job

    def snapshot(self, job_id: str) -> StaticJobResponse | None:
        with self._lock:
            if self._job is None or self._job.jobId != job_id:
                return None
            return self._job.model_copy(deep=True)

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
