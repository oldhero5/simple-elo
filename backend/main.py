"""Elo Rater API. Run with `uvicorn main:app` from this directory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import Settings
from db import Database
from routers import matchups, personnel, reports, rounds
from schemas import HealthOut


def _configure_logging(level_name: str) -> None:
    level = logging.getLevelNamesMapping().get(level_name, logging.INFO)
    logging.basicConfig(
        level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )


def _describe_validation_error(exc: RequestValidationError) -> str:
    messages = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ()) if part != "body"]
        field = ".".join(location) if location else "Request body"
        messages.append(f"{field}: {error.get('msg', 'is invalid')}")
    return "; ".join(messages) or "Invalid request"


async def _validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Keep "detail" a readable string like every other error; the structured
    # list stays available under "errors".
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "detail": _describe_validation_error(exc),
            "errors": jsonable_encoder(exc.errors()),
        },
    )


# The OpenAPI document must describe the 422 body that _validation_error sends.
_VALIDATION_ERROR_SCHEMA = {
    "title": "HTTPValidationError",
    "type": "object",
    "properties": {
        "detail": {"type": "string", "title": "Detail"},
        "errors": {
            "type": "array",
            "title": "Errors",
            "items": {"$ref": "#/components/schemas/ValidationError"},
        },
    },
    "required": ["detail", "errors"],
}


def _use_validation_error_schema(app: FastAPI) -> None:
    generate = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            schemas = generate().get("components", {}).get("schemas", {})
            if "HTTPValidationError" in schemas:
                schemas["HTTPValidationError"] = _VALIDATION_ERROR_SCHEMA
        return app.openapi_schema

    app.openapi = openapi


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    # Starlette re-raises after this handler runs, so the server still logs the
    # traceback; the client only gets a generic message.
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        _configure_logging(settings.log_level)
        database = Database(settings.database_path)
        database.open()
        app.state.db = database
        try:
            yield
        finally:
            database.close()

    app = FastAPI(
        title="Elo Rater API",
        description="Pairwise Elo ratings for a team.",
        version="2.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_error)

    # The frontend proxies /api on its own origin, so CORS is off unless asked for.
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/api/health", response_model=HealthOut, tags=["health"])
    def health() -> HealthOut:
        return HealthOut(status="ok")

    for module in (personnel, rounds, matchups, reports):
        app.include_router(module.router)
    _use_validation_error_schema(app)
    return app


app = create_app()
