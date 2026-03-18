"""
ATS Service Application Package

This package contains the core ATS (Applicant Tracking System) service.
It provides resume parsing, skill extraction, and scoring capabilities.

Architecture:
- routes/: HTTP endpoint handlers
- services/: Business logic (parsing, extraction, scoring)
- utils/: Helper functions (text cleaning, etc.)
- models/: Data schemas and response structures
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import logging.config
import nltk
from nltk.corpus import stopwords

from app.config import (
    APP_TITLE,
    APP_DESCRIPTION,
    APP_VERSION,
    ALLOWED_ORIGINS,
)

# ── Logging configuration ──────────────────────────────────────────
# Configure once at package import time so all sub-module loggers
# inherit this format and level automatically.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Global state (populated by initialize_nlp_resources)
SBERT_ENABLED = False
sbert_model = None
STOP_WORDS = set()


def initialize_nlp_resources():
    """
    Initialize NLP resources like stopwords and SBERT model.
    
    This function is called once when the application starts.
    It downloads necessary NLTK data and attempts to load the SBERT model.
    
    Returns:
        tuple: (sbert_model, SBERT_ENABLED, STOP_WORDS)
    """
    global sbert_model, SBERT_ENABLED, STOP_WORDS
    
    try:
        # Download stopwords if not already present
        try:
            nltk.download('stopwords', quiet=True, raise_on_error=True)
            STOP_WORDS = set(stopwords.words('english'))
        except Exception as download_error:
            logger.warning("Could not download NLTK stopwords: %s", download_error)
            STOP_WORDS = set()

        # Try to load SBERT model for semantic analysis
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading SBERT model for semantic analysis...")
            sbert_model = SentenceTransformer('all-MiniLM-L6-v2')
            SBERT_ENABLED = True
            logger.info("✅ SBERT model loaded successfully")
        except Exception as sbert_error:
            logger.warning("Could not load SBERT model: %s — falling back to TF-IDF", sbert_error)
            sbert_model = None
            SBERT_ENABLED = False

    except Exception as e:
        logger.warning("Could not initialise NLP resources: %s — falling back to TF-IDF", e)
        STOP_WORDS = set()
        sbert_model = None
        SBERT_ENABLED = False
    
    return sbert_model, SBERT_ENABLED, STOP_WORDS


def create_app() -> FastAPI:
    """
    Factory function to create and configure the FastAPI application.
    
    This function:
    1. Creates a FastAPI instance
    2. Configures CORS middleware for cross-origin requests
    3. Initializes NLP resources
    4. Registers all routes
    
    Returns:
        FastAPI: Configured FastAPI application instance
    """
    logger.info("Creating FastAPI application — %s v%s", APP_TITLE, APP_VERSION)

    # Create FastAPI app
    app = FastAPI(
        title=APP_TITLE,
        description=APP_DESCRIPTION,
        version=APP_VERSION
    )

    # Configure CORS — allows frontend to communicate with this service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],  # Allow all HTTP methods
        allow_headers=["*"],  # Allow all headers
    )
    
    # Initialize NLP resources
    initialize_nlp_resources()
    
    # Register routes
    from app.routes import score
    app.include_router(score.router)
    
    return app
