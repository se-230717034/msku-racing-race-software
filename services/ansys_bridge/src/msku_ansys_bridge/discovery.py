from __future__ import annotations

import os
import platform
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import Literal

MINIMUM_MECHANICAL_VERSION_CODE = 242
PYMECHANICAL_DISTRIBUTION = "ansys-mechanical-core"
_VERSION_DIRECTORY = re.compile(r"^v(?P<code>\d{3})$", re.IGNORECASE)
_AWP_ROOT = re.compile(r"^AWP_ROOT(?P<code>\d{3})$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class AnsysInstallation:
    version_code: int
    release: str
    root: Path
    executable: Path
    product_kind: Literal["student", "other"]
    source: str


@dataclass(frozen=True, slots=True)
class InstallationDiscovery:
    platform: str
    state: Literal["FOUND", "NOT_FOUND", "UNSUPPORTED_PLATFORM"]
    installations: tuple[AnsysInstallation, ...]
    selected: AnsysInstallation | None
    warnings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PyMechanicalCompatibility:
    state: Literal[
        "COMPATIBLE",
        "NOT_EVALUATED",
        "PYMECHANICAL_NOT_INSTALLED",
        "MECHANICAL_VERSION_UNSUPPORTED",
        "PYTHON_VERSION_UNSUPPORTED",
    ]
    pymechanical_version: str | None
    python_version: str
    minimum_mechanical_version_code: int
    message: str


def release_label(version_code: int) -> str:
    year = 2000 + version_code // 10
    release = version_code % 10
    return f"{year} R{release}"


def _candidate(root: Path, version_code: int, source: str) -> AnsysInstallation | None:
    executable = root / "aisol" / "bin" / "winx64" / "AnsysWBU.exe"
    if not executable.is_file():
        return None
    product_kind: Literal["student", "other"] = (
        "student" if any(part.casefold() == "ansys student" for part in root.parts) else "other"
    )
    return AnsysInstallation(
        version_code=version_code,
        release=release_label(version_code),
        root=root,
        executable=executable,
        product_kind=product_kind,
        source=source,
    )


def discover_windows_installations(
    *,
    environment: Mapping[str, str] | None = None,
    program_files: Path | None = None,
    system: str | None = None,
) -> InstallationDiscovery:
    """Discover known Mechanical roots without executing any Ansys binary."""

    active_system = system or platform.system()
    if active_system != "Windows":
        return InstallationDiscovery(
            platform=active_system,
            state="UNSUPPORTED_PLATFORM",
            installations=(),
            selected=None,
            warnings=("ANSYS_STUDENT_DISCOVERY_WINDOWS_ONLY",),
        )

    active_environment = environment if environment is not None else os.environ
    base = program_files or Path(active_environment.get("ProgramFiles", r"C:\Program Files"))
    candidates: list[tuple[Path, int, str]] = []
    warnings: list[str] = []

    for name, value in active_environment.items():
        match = _AWP_ROOT.fullmatch(name)
        if match and value.strip():
            candidates.append((Path(value.strip()), int(match.group("code")), name.upper()))

    ansys_root = base / "ANSYS Inc"
    for product_root, source in (
        (ansys_root / "ANSYS Student", "default_student_root"),
        (ansys_root, "default_ansys_root"),
    ):
        try:
            version_roots = tuple(product_root.iterdir()) if product_root.is_dir() else ()
        except OSError:
            warnings.append("ANSYS_INSTALLATION_ROOT_NOT_READABLE")
            continue
        for version_root in version_roots:
            match = _VERSION_DIRECTORY.fullmatch(version_root.name)
            if match:
                candidates.append((version_root, int(match.group("code")), source))

    installations_by_path: dict[str, AnsysInstallation] = {}
    for root, version_code, source in candidates:
        if str(root).startswith(r"\\"):
            warnings.append(f"REMOTE_INSTALLATION_PATH_REJECTED:{version_code}")
            continue
        installation = _candidate(root, version_code, source)
        key = str(root.absolute()).casefold()
        if installation is None:
            if root.exists():
                warnings.append(f"MECHANICAL_EXECUTABLE_MISSING:{version_code}")
            continue
        current = installations_by_path.get(key)
        if current is None or source.startswith("AWP_ROOT"):
            installations_by_path[key] = installation

    installations = tuple(
        sorted(
            installations_by_path.values(),
            key=lambda item: (item.product_kind == "student", item.version_code),
            reverse=True,
        )
    )
    selected = installations[0] if installations else None
    return InstallationDiscovery(
        platform=active_system,
        state="FOUND" if selected else "NOT_FOUND",
        installations=installations,
        selected=selected,
        warnings=tuple(sorted(set(warnings))),
    )


def pymechanical_compatibility(
    installation: AnsysInstallation | None,
    *,
    python_version: tuple[int, int] | None = None,
    distribution_version: str | None = None,
) -> PyMechanicalCompatibility:
    active_python = python_version or (sys.version_info.major, sys.version_info.minor)
    package_version = distribution_version
    if package_version is None:
        try:
            package_version = metadata.version(PYMECHANICAL_DISTRIBUTION)
        except metadata.PackageNotFoundError:
            package_version = None

    python_label = f"{active_python[0]}.{active_python[1]}"
    if installation is None:
        return PyMechanicalCompatibility(
            state="NOT_EVALUATED",
            pymechanical_version=package_version,
            python_version=python_label,
            minimum_mechanical_version_code=MINIMUM_MECHANICAL_VERSION_CODE,
            message="Uyumluluk için doğrulanabilir bir Mechanical kurulumu bulunamadı.",
        )
    if package_version is None:
        return PyMechanicalCompatibility(
            state="PYMECHANICAL_NOT_INSTALLED",
            pymechanical_version=None,
            python_version=python_label,
            minimum_mechanical_version_code=MINIMUM_MECHANICAL_VERSION_CODE,
            message="ansys-mechanical-core Python paketi kurulu değil.",
        )
    if not ((3, 12) <= active_python <= (3, 14)):
        return PyMechanicalCompatibility(
            state="PYTHON_VERSION_UNSUPPORTED",
            pymechanical_version=package_version,
            python_version=python_label,
            minimum_mechanical_version_code=MINIMUM_MECHANICAL_VERSION_CODE,
            message="Güncel PyMechanical belgeleri Python 3.12–3.14 aralığını destekliyor.",
        )
    if installation.version_code < MINIMUM_MECHANICAL_VERSION_CODE:
        return PyMechanicalCompatibility(
            state="MECHANICAL_VERSION_UNSUPPORTED",
            pymechanical_version=package_version,
            python_version=python_label,
            minimum_mechanical_version_code=MINIMUM_MECHANICAL_VERSION_CODE,
            message="PyMechanical için Mechanical 2024 R2 (v242) veya sonrası gerekli.",
        )
    return PyMechanicalCompatibility(
        state="COMPATIBLE",
        pymechanical_version=package_version,
        python_version=python_label,
        minimum_mechanical_version_code=MINIMUM_MECHANICAL_VERSION_CODE,
        message=(
            "Kurulum sürümü belgelenmiş PyMechanical aralığında; gerçek bağlantı ve lisans "
            "ayrıca doğrulanmalıdır."
        ),
    )
