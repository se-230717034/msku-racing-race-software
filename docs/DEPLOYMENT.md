# Deployment

## Local

Use `npm run dev` for Vite and `npm run api:dev` for FastAPI. Configure the browser endpoint with `VITE_API_BASE_URL` and API CORS with `MSKU_API_CORS_ORIGINS`.

## Containers

`docker compose up --build` builds an Nginx-served static web application and a Python API. This topology is intended for local verification, not a production security baseline.

## Suggested hosted topology

- Web: Vercel or another static/edge frontend host.
- API and future solver workers: a Python-capable container host with explicit CPU/memory/time limits.
- Future persistence: managed PostgreSQL plus object storage for large exports.

Do not place long-running SciPy solver work inside a static frontend deployment. Phase 5 optimization should use asynchronous jobs, cancellation, resource limits, and durable result records.

## Production checklist

- Pin deployment images and run all quality gates.
- Restrict CORS to the deployed web origin.
- Add TLS, request-size limits, structured logs, tracing, rate limits, and health/readiness probes.
- Add authentication and project-level access control before storing private vehicle data.
- Back up database/object storage and test restoration.
- Preserve input schema version, solver version, warnings, and model status with every result.

