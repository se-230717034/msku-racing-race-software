"""Opt-in, real Mechanical modal analysis with no synthetic result fallback."""

from __future__ import annotations

import math
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .adapter import MechanicalClient
from .analysis import (
    STUDENT_MESH_PRECHECK_LIMIT,
    STUDENT_SAFE_SOLVE_CORES,
    AnalysisError,
    AnalysisStage,
    MeshQualityEvidence,
    OwnedMechanical,
    _ascii_project_path,
    _count,
    _mesh_quality,
    _payload,
    _shape_check_in_solver_input,
    _si_quantity,
    _solver_failure,
    _solver_warning_summary,
    _validated_geometry,
)
from .studio_transfer import StudioTransfer, StudioTransferEvidence, transfer_evidence


class ModalAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    geometryPath: str = Field(min_length=1, max_length=1024)
    material: Literal["Structural Steel"] = "Structural Steel"
    fixedNamedSelection: str = Field(min_length=1, max_length=100, pattern=r"^[\w .-]+$")
    meshSizeMm: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)
    modeCount: int = Field(ge=1, le=6)
    studioTransfer: StudioTransfer | None = None

    @model_validator(mode="after")
    def valid_name(self) -> ModalAnalysisRequest:
        if self.fixedNamedSelection != self.fixedNamedSelection.strip():
            raise ValueError("Named selection adı başında/sonunda boşluk içeremez")
        return self


class ModalMode(BaseModel):
    modeNumber: int
    frequencyHz: float


class ModalAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    solverStatus: Literal["Done"] = "Done"
    modes: list[ModalMode]
    meshNodes: int
    meshElements: int
    resultFileBytes: int = Field(default=0, ge=0)
    bodyCount: int = Field(default=0, ge=0)
    fixedScopeEntityCount: int = Field(default=0, ge=0)
    meshSizeMm: float
    meshQuality: MeshQualityEvidence
    geometrySha256: str
    material: str
    fixedNamedSelection: str
    mechanicalVersion: str
    productInfo: str
    shapeCheckInSolverInput: bool
    studioTransfer: StudioTransferEvidence | None = None
    units: Literal["SI"] = "SI"
    validationStatus: Literal["NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"] = (
        "NUMERIC_RESULT_UNVALIDATED_PHYSICALLY"
    )
    meshConvergenceStatus: Literal["NOT_ASSESSED"] = "NOT_ASSESSED"
    warnings: list[str] = Field(default_factory=list)


class ModalJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    state: Literal["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]
    stage: AnalysisStage
    message: str
    startedAt: str
    completedAt: str | None = None
    errorCode: str | None = None
    result: ModalAnalysisResult | None = None


def _modal_setup_script(request: ModalAnalysisRequest, path: Path) -> str:
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
    raise RuntimeError('MSKU_NO_GEOMETRY_BODIES')
MSKU_NAMES = list(Model.NamedSelections.Children)
MSKU_FIXED = [x for x in MSKU_NAMES if x.Name == {request.fixedNamedSelection!r}]
if len(MSKU_FIXED) != 1 or not MSKU_FIXED[0].Ids:
    raise RuntimeError('MSKU_FIXED_SELECTION_MISSING_OR_EMPTY')
MSKU_MATERIAL = Model.Materials.AddMaterialAssignment()
MSKU_MATERIAL.Material = {request.material!r}
MSKU_GEOMETRY_ENTITIES = Ansys.ACT.Interfaces.Common.SelectionTypeEnum.GeometryEntities
MSKU_SELECTION = ExtAPI.SelectionManager.CreateSelectionInfo(MSKU_GEOMETRY_ENTITIES)
MSKU_SELECTION.Ids = [body.GetGeoBody().Id for body in MSKU_BODIES]
MSKU_MATERIAL.Location = MSKU_SELECTION
MSKU_ANALYSIS = Model.AddModalAnalysis()
MSKU_ANALYSIS.AnalysisSettings.MaximumModesToFind = {request.modeCount}
MSKU_SHAPE_CHECK = MSKU_ANALYSIS.AddCommandSnippet()
MSKU_SHAPE_CHECK.Input = '/PREP7\\nSHPP,ON,ALL\\nCHECK\\n/SOLU'
MSKU_SUPPORT = MSKU_ANALYSIS.AddFixedSupport()
MSKU_SUPPORT.Location = MSKU_FIXED[0]
MSKU_MODAL_MODES = []
for MSKU_INDEX in range(1, {request.modeCount} + 1):
    MSKU_RESULT = MSKU_ANALYSIS.Solution.AddTotalDeformation()
    MSKU_RESULT.Mode = MSKU_INDEX
    MSKU_MODAL_MODES.append(MSKU_RESULT)
json.dumps({{'bodies': len(MSKU_BODIES), 'fixedFaces': len(MSKU_FIXED[0].Ids),
            'configuredModes': int(MSKU_ANALYSIS.AnalysisSettings.MaximumModesToFind),
            'studioHardpoints': len(MSKU_STUDIO_HARDPOINTS_CAD_MM)}})
""".strip()


def run_modal_analysis(
    client: MechanicalClient,
    request: ModalAnalysisRequest,
    progress: Callable[[AnalysisStage, str], None],
) -> ModalAnalysisResult:
    path, digest = _validated_geometry(request.geometryPath)
    progress("importing", "Modal CAD, malzeme ve sabit mesnet kapsamı doğrulanıyor.")
    client.clear()
    setup = _payload(client.run_python_script(_modal_setup_script(request, path)), "modal CAD")
    body_count = _count(setup.get("bodies"), "gövde")
    fixed_count = _count(setup.get("fixedFaces"), "mesnet yüzeyi")
    if setup.get("configuredModes") != request.modeCount:
        raise AnalysisError("MODAL_MODE_COUNT_NOT_CONFIRMED", "Modal mod sayısı doğrulanamadı.")
    if request.studioTransfer is not None and setup.get("studioHardpoints") != 9:
        raise AnalysisError(
            "STUDIO_TRANSFER_NOT_CONFIRMED", "Studio hardpoint aktarımı doğrulanamadı."
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
        raise AnalysisError("SOLVE_CORE_CONFIGURATION_FAILED", "İki çekirdek sınırı doğrulanamadı.")
    try:
        client.run_python_script(
            "ExtAPI.DataModel.Project.SaveAs(" + repr(_ascii_project_path()) + ", False)"
        )
    except Exception as exc:
        raise AnalysisError(
            "ANSYS_PROJECT_SAVE_FAILED", "Modal proje yerel ASCII yola kaydedilemedi."
        ) from exc
    workdir_raw = client.run_python_script("MSKU_ANALYSIS.WorkingDir")
    workdir = Path(str(workdir_raw))
    if not workdir.is_absolute() or not str(workdir).isascii():
        raise AnalysisError("ANSYS_ASCII_WORKDIR_NOT_CONFIRMED", "Modal çalışma dizini geçersiz.")

    progress("meshing", "Modal mesh oluşturuluyor ve Student sınırı denetleniyor.")
    mesh = _payload(
        client.run_python_script(
            "Model.Mesh.ElementSize = Quantity(" + repr(request.meshSizeMm) + ", 'mm')\n"
            "Model.Mesh.GenerateMesh()\n"
            "import json\njson.dumps({'nodes': int(Model.Mesh.Nodes), "
            "'elements': int(Model.Mesh.Elements)})"
        ),
        "modal mesh",
    )
    nodes = _count(mesh.get("nodes"), "düğüm")
    elements = _count(mesh.get("elements"), "eleman")
    if nodes > STUDENT_MESH_PRECHECK_LIMIT or elements > STUDENT_MESH_PRECHECK_LIMIT:
        raise AnalysisError("STUDENT_MESH_LIMIT_PRECHECK", "Modal mesh Student sınırını aştı.")
    quality = _mesh_quality(client)

    progress("solving", "Gerçek Mechanical Modal çözümü çalışıyor.")
    solved = _payload(
        client.run_python_script(
            "MSKU_ANALYSIS.Solution.Solve(True)\n"
            "import json\njson.dumps({'status': str(MSKU_ANALYSIS.Solution.Status)})"
        ),
        "modal solve",
    )
    status = str(solved.get("status", "")).split(".")[-1]
    if status != "Done":
        raise _solver_failure(workdir, status)
    result_file = workdir / "file.rst"
    if not result_file.is_file() or result_file.stat().st_size == 0:
        raise AnalysisError("MODAL_RESULT_FILE_MISSING", "Modal sonuç dosyası eksik veya boş.")

    progress("extracting", "Doğal frekanslar Mechanical sonuç nesnelerinden okunuyor.")
    payload = _payload(
        client.run_python_script(
            "MSKU_ANALYSIS.Solution.EvaluateAllResults()\n"
            "import json\njson.dumps({'status': str(MSKU_ANALYSIS.Solution.Status), "
            "'frequencies': [str(item.ReportedFrequency) for item in MSKU_MODAL_MODES]})"
        ),
        "modal sonuç",
    )
    if str(payload.get("status", "")).split(".")[-1] != "Done":
        raise AnalysisError("SOLVER_STATUS_CHANGED", "Modal sonuç okunurken çözüm durumu değişti.")
    raw_frequencies = payload.get("frequencies")
    if not isinstance(raw_frequencies, list) or len(raw_frequencies) != request.modeCount:
        raise AnalysisError("MODAL_FREQUENCIES_MISSING", "İstenen tüm mod frekansları dönmedi.")
    frequencies = [_si_quantity(raw, "Hz") for raw in raw_frequencies]
    if any(value <= 0 or not math.isfinite(value) for value in frequencies):
        raise AnalysisError(
            "MODAL_FREQUENCY_INVALID", "Sıfır/negatif modal frekans kabul edilmedi."
        )
    if any(left > right for left, right in zip(frequencies[:-1], frequencies[1:], strict=True)):
        raise AnalysisError("MODAL_FREQUENCY_ORDER", "Modal frekans sırası tutarsız.")

    warnings = [
        "Modal frekanslar yalnızca tanımlı CAD, malzeme ve mesnet için sayısal sonuçtur; "
        "gerçek araçla fiziksel korelasyon yapılmadı.",
        "Modal mesh yakınsaması değerlendirilmedi; frekanslar mesh-bağımsız kabul edilmez.",
        "Modal şekil deplasmanlarının ölçeği fiziksel bir zorlanmış deplasman değildir.",
        "Structural Steel ANSYS kütüphane malzemesidir; takım ölçümü değildir.",
        "Student lisans sınırı solver tarafından ayrıca uygulanır.",
        *_solver_warning_summary(workdir),
    ]
    if quality.status == "UNAVAILABLE":
        warnings.append("Mechanical eleman kalite metriği okunamadı.")
    shape_check = _shape_check_in_solver_input(workdir)
    if not shape_check:
        warnings.append("APDL şekil denetimi solver girdisinde doğrulanamadı.")
    if request.studioTransfer is not None:
        warnings.append(
            "Studio hardpointleri izleme verisi olarak aktarıldı; CAD topolojisine ve "
            "modal mesnete otomatik bağlanmadı. CAD anchor eşleşmesi kullanıcı beyanıdır."
        )
        if request.studioTransfer.dataClassification == "demonstration":
            warnings.append("DEMO/SYNTHETIC geometri gerçek araç CAD verisi değildir.")
    return ModalAnalysisResult(
        modes=[
            ModalMode(modeNumber=index, frequencyHz=value)
            for index, value in enumerate(frequencies, start=1)
        ],
        meshNodes=nodes,
        meshElements=elements,
        resultFileBytes=result_file.stat().st_size,
        bodyCount=body_count,
        fixedScopeEntityCount=fixed_count,
        meshSizeMm=request.meshSizeMm,
        meshQuality=quality,
        geometrySha256=digest,
        material=request.material,
        fixedNamedSelection=request.fixedNamedSelection,
        mechanicalVersion=str(client.version),
        productInfo=str(client.get_product_info())[:500],
        shapeCheckInSolverInput=shape_check,
        studioTransfer=(
            transfer_evidence(request.studioTransfer) if request.studioTransfer else None
        ),
        warnings=warnings,
    )


class ModalAnalysisManager:
    def __init__(self, adapter: OwnedMechanical) -> None:
        self._adapter = adapter
        self._lock = threading.Lock()
        self._job: ModalJobResponse | None = None
        self._request: ModalAnalysisRequest | None = None

    def start(self, request: ModalAnalysisRequest) -> ModalJobResponse:
        _validated_geometry(request.geometryPath)
        with self._lock:
            if self._job and self._job.state in {"QUEUED", "RUNNING"}:
                raise AnalysisError("ANALYSIS_ALREADY_RUNNING", "Modal analiz zaten çalışıyor.")
            self._job = ModalJobResponse(
                jobId=str(uuid4()),
                state="QUEUED",
                stage="queued",
                message="Açık modal analiz isteği alındı; yerel Mechanical bekleniyor.",
                startedAt=datetime.now(UTC).isoformat(),
            )
            self._request = request.model_copy(deep=True)
            job = self._job.model_copy(deep=True)
        threading.Thread(target=self._work, args=(request,), daemon=False).start()
        return job

    def snapshot(self, job_id: str) -> ModalJobResponse | None:
        with self._lock:
            if self._job is None or self._job.jobId != job_id:
                return None
            return self._job.model_copy(deep=True)

    def report_source(self, job_id: str) -> tuple[ModalAnalysisRequest, ModalJobResponse] | None:
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

    def _work(self, request: ModalAnalysisRequest) -> None:
        try:
            result = self._adapter.run_with_owned_client(
                lambda client: run_modal_analysis(client, request, self._progress)
            )
        except AnalysisError as exc:
            self._finish("FAILED", exc.code, exc.message, None)
        except Exception as exc:
            # Never expose raw Mechanical logs, CAD paths, or license information.
            lowered = f"{type(exc).__name__} {exc}".casefold()
            if "msku_fixed_selection_missing_or_empty" in lowered:
                self._finish(
                    "FAILED", "FIXED_SELECTION_MISSING", "Modal CAD mesnet seçimi eksik.", None
                )
            elif "license" in lowered:
                self._finish(
                    "FAILED", "ANSYS_LICENSE_ERROR", "Modal çözüm lisansı kullanılamıyor.", None
                )
            elif "material" in lowered:
                self._finish(
                    "FAILED",
                    "MATERIAL_NOT_AVAILABLE",
                    "Structural Steel malzemesi Mechanical içinde atanamadı.",
                    None,
                )
            else:
                self._finish(
                    "FAILED",
                    "MECHANICAL_MODAL_FAILED",
                    "Mechanical modal analiz başarısız; yerel günlükleri kontrol edin.",
                    None,
                )
        else:
            self._finish(
                "SUCCEEDED", None, "Mechanical modal çözüm ve frekanslar doğrulandı.", result
            )

    def _finish(
        self,
        state: Literal["SUCCEEDED", "FAILED"],
        code: str | None,
        message: str,
        result: ModalAnalysisResult | None,
    ) -> None:
        with self._lock:
            if self._job is not None:
                self._job.state = state
                self._job.stage = "done"
                self._job.errorCode = code
                self._job.message = message
                self._job.result = result
                self._job.completedAt = datetime.now(UTC).isoformat()
