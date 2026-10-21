from __future__ import annotations

from pathlib import Path

from msku_ansys_bridge.discovery import (
    AnsysInstallation,
    discover_windows_installations,
    pymechanical_compatibility,
    release_label,
)


def make_executable(root: Path) -> Path:
    executable = root / "aisol" / "bin" / "winx64" / "AnsysWBU.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"test fixture, never executed")
    return executable


def test_detects_student_installation_from_awp_root(tmp_path: Path) -> None:
    student_root = tmp_path / "ANSYS Inc" / "ANSYS Student" / "v261"
    executable = make_executable(student_root)

    result = discover_windows_installations(
        environment={"AWP_ROOT261": str(student_root)},
        program_files=tmp_path / "unused",
        system="Windows",
    )

    assert result.state == "FOUND"
    assert result.selected is not None
    assert result.selected.version_code == 261
    assert result.selected.release == "2026 R1"
    assert result.selected.product_kind == "student"
    assert result.selected.executable == executable
    assert result.selected.source == "AWP_ROOT261"


def test_accepts_only_structurally_valid_explicit_mechanical_executable(tmp_path: Path) -> None:
    student_root = tmp_path / "ANSYS Inc" / "ANSYS Student" / "v261"
    executable = make_executable(student_root).absolute()

    result = discover_windows_installations(
        environment={},
        program_files=tmp_path / "unused",
        system="Windows",
        explicit_executable=executable,
    )

    assert result.selected is not None
    assert result.selected.executable == executable
    assert result.selected.source == "explicit_executable"

    invalid = tmp_path / "arbitrary.exe"
    invalid.write_bytes(b"never executed")
    rejected = discover_windows_installations(
        environment={},
        program_files=tmp_path / "unused",
        system="Windows",
        explicit_executable=invalid,
    )
    assert rejected.selected is None
    assert "EXPLICIT_MECHANICAL_EXECUTABLE_INVALID" in rejected.warnings


def test_explicit_executable_overrides_default_installation(tmp_path: Path) -> None:
    program_files = tmp_path / "Program Files"
    default = make_executable(program_files / "ANSYS Inc" / "ANSYS Student" / "v261")
    explicit = make_executable(tmp_path / "Custom" / "ANSYS Student" / "v251")

    result = discover_windows_installations(
        environment={},
        program_files=program_files,
        system="Windows",
        explicit_executable=explicit.absolute(),
    )

    assert default.is_file()
    assert result.selected is not None
    assert result.selected.executable == explicit.absolute()


def test_explicit_executable_remains_source_when_awp_root_matches(tmp_path: Path) -> None:
    student_root = tmp_path / "ANSYS Inc" / "ANSYS Student" / "v261"
    executable = make_executable(student_root).absolute()

    result = discover_windows_installations(
        environment={"AWP_ROOT261": str(student_root)},
        program_files=tmp_path / "unused",
        system="Windows",
        explicit_executable=executable,
    )

    assert result.selected is not None
    assert result.selected.executable == executable
    assert result.selected.source == "explicit_executable"


def test_prefers_latest_student_installation_and_deduplicates_paths(tmp_path: Path) -> None:
    program_files = tmp_path / "Program Files"
    student = program_files / "ANSYS Inc" / "ANSYS Student" / "v251"
    other = program_files / "ANSYS Inc" / "v261"
    make_executable(student)
    make_executable(other)

    result = discover_windows_installations(
        environment={"AWP_ROOT251": str(student)},
        program_files=program_files,
        system="Windows",
    )

    assert len(result.installations) == 2
    assert result.selected is not None
    assert result.selected.product_kind == "student"
    assert result.selected.version_code == 251
    assert result.selected.source == "AWP_ROOT251"


def test_does_not_claim_discovery_on_non_windows_platform() -> None:
    result = discover_windows_installations(environment={}, system="Linux")

    assert result.state == "UNSUPPORTED_PLATFORM"
    assert result.selected is None
    assert result.warnings == ("ANSYS_STUDENT_DISCOVERY_WINDOWS_ONLY",)


def test_reports_broken_candidate_without_treating_it_as_an_installation(tmp_path: Path) -> None:
    root = tmp_path / "ANSYS Student" / "v261"
    root.mkdir(parents=True)

    result = discover_windows_installations(
        environment={"AWP_ROOT261": str(root)},
        program_files=tmp_path / "unused",
        system="Windows",
    )

    assert result.state == "NOT_FOUND"
    assert result.installations == ()
    assert result.warnings == ("MECHANICAL_EXECUTABLE_MISSING:261",)


def test_rejects_unc_installation_candidates_without_network_access(tmp_path: Path) -> None:
    result = discover_windows_installations(
        environment={"AWP_ROOT261": r"\\server\share\ANSYS Student\v261"},
        program_files=tmp_path / "unused",
        system="Windows",
    )

    assert result.state == "NOT_FOUND"
    assert result.warnings == ("REMOTE_INSTALLATION_PATH_REJECTED:261",)


def test_compatibility_requires_supported_python_mechanical_and_package() -> None:
    installation = AnsysInstallation(
        version_code=242,
        release=release_label(242),
        root=Path("C:/Ansys/v242"),
        executable=Path("C:/Ansys/v242/aisol/bin/winx64/AnsysWBU.exe"),
        product_kind="student",
        source="fixture",
    )

    compatible = pymechanical_compatibility(
        installation,
        python_version=(3, 12),
        distribution_version="0.13.4",
    )
    unsupported_python = pymechanical_compatibility(
        installation,
        python_version=(3, 11),
        distribution_version="0.13.4",
    )
    old_installation = AnsysInstallation(
        version_code=241,
        release=release_label(241),
        root=installation.root,
        executable=installation.executable,
        product_kind="student",
        source="fixture",
    )
    unsupported_mechanical = pymechanical_compatibility(
        old_installation,
        python_version=(3, 12),
        distribution_version="0.13.4",
    )

    assert compatible.state == "COMPATIBLE"
    assert unsupported_python.state == "PYTHON_VERSION_UNSUPPORTED"
    assert unsupported_mechanical.state == "MECHANICAL_VERSION_UNSUPPORTED"
