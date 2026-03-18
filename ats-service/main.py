import warnings
import os
warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", category=UserWarning)
os.environ["PYTHONWARNINGS"] = "ignore"

"""
ATS Service - Main Entry Point

This is the entry point for the ATS (Applicant Tracking System) microservice.
It creates and runs the FastAPI application.

What is ATS?
------------
An Applicant Tracking System (ATS) is software that helps companies manage
job applications. It automatically screens resumes by:
1. Parsing resume files (PDF, DOCX) to extract text
2. Identifying key sections (education, experience, skills)
3. Comparing resume content to job descriptions
4. Scoring resumes based on relevance and completeness

Why is this a separate microservice?
------------------------------------
In a microservices architecture, different parts of an application run as
independent services. The ATS service is separate because:

1. **Separation of Concerns**: Resume processing is a distinct responsibility
   - Main backend handles user auth, database, API
   - ATS service handles resume parsing and scoring
   
2. **Independent Scaling**: Resume parsing is CPU-intensive
   - Can scale ATS service independently based on load
   - Main backend might need different scaling strategy
   
3. **Technology Isolation**: ATS uses Python ML libraries
   - Main backend uses Node.js/Express
   - Each service uses the best tools for its job
   
4. **Fault Isolation**: If ATS service crashes, main app keeps running
   - Better reliability and error handling
   
5. **Independent Deployment**: Can update ATS without touching main backend
   - Faster iteration and testing

How does it work?
-----------------
Request Flow:
1. Frontend sends resume file to main backend
2. Main backend forwards file to ATS service (this service)
3. ATS service:
   a. Extracts text from file (parser.py)
   b. Identifies skills and sections (extractor.py)
   c. Calculates ATS score (scorer.py)
   d. Returns structured response (response_schema.py)
4. Main backend receives score and stores in database
5. Frontend displays score to user

Architecture:
- app/routes/: HTTP endpoints (handles requests/responses)
- app/services/: Business logic (parsing, scoring)
- app/utils/: Helper functions (text cleaning)
- app/models/: Data schemas (response structure)
"""

from app import create_app

# Create FastAPI application
app = create_app()

# Run server when executed directly
if __name__ == '__main__':
    import uvicorn
    
    # Start server on all interfaces (0.0.0.0) port 8000
    # This allows the service to accept requests from other services
    uvicorn.run(
        app,
        host='0.0.0.0',  # Listen on all network interfaces
        port=8000,       # Port number
        log_level='info' # Logging level
    )
