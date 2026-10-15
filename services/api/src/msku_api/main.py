from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from msku_engineering import validate_corner

from .models import DiagnosticResponse, Project, ProjectValidationResponse

app = FastAPI(
    title="MSKU Racing Dynamics Studio API",
    version="0.1.0",
    description=(
        "Typed validation boundary. No kinematics or dynamics are implemented "
        "in this release."
    ),
)

origins = [
    item.strip()
    for item in os.getenv(
        "MSKU_API_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "msku-racing-api", "version": "0.1.0"}


@app.post("/api/v1/projects/validate", response_model=ProjectValidationResponse)
async def validate_project(project: Project) -> ProjectValidationResponse:
    points = {
        point.id: (point.position.x, point.position.y, point.position.z)
        for point in project.suspension.hardpoints
    }
    diagnostics = validate_corner(
        points,
        project.suspension.wheel.radius,
        project.suspension.wheel.width,
    )
    response_diagnostics = [
        DiagnosticResponse(
            severity=item.severity,
            code=item.code,
            message=item.message,
            points=list(item.points),
        )
        for item in diagnostics
    ]
    return ProjectValidationResponse(
        valid=not any(item.severity == "error" for item in diagnostics),
        schemaVersion="1.0.0",
        units={"length": "m", "angle": "rad"},
        diagnostics=response_diagnostics,
    )


@app.get("/api/v1/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        "implemented": ["project_validation", "static_geometry_diagnostics"],
        "notImplemented": [
            "kinematics",
            "quasi_static_loads",
            "dynamics",
            "road_simulation",
            "optimization",
            "reports",
        ],
        "modelStatus": "demonstration",
    }
