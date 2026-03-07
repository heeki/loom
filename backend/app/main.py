"""
Loom Backend API

FastAPI application for the Loom Agent Builder Playground.
Provides endpoints for agent registration, invocation, and log retrieval.
"""
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routers import agents, auth, credentials, integrations, invocations, logs, security

# Configure logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "info").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.

    Initializes the database on startup and performs cleanup on shutdown.
    """
    logger.info("Initializing Loom backend...")

    # Initialize database (create tables if they don't exist)
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise

    yield

    # Cleanup (if needed)
    logger.info("Shutting down Loom backend...")


# Create FastAPI application
app = FastAPI(
    title="Loom Backend API",
    description="Backend API for the Loom Agent Builder Playground",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS
FRONTEND_PORT = os.getenv("LOOM_FRONTEND_PORT", "5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{FRONTEND_PORT}",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(agents.router)
app.include_router(auth.router)
app.include_router(credentials.router)
app.include_router(integrations.router)
app.include_router(invocations.router)
app.include_router(logs.router)
app.include_router(security.router)


@app.get("/")
async def root() -> dict:
    """Root endpoint - health check."""
    return {
        "service": "Loom Backend API",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("LOOM_BACKEND_PORT", "8000"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level=LOG_LEVEL.lower()
    )
