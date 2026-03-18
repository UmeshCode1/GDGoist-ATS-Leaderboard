"""
Simple ATS Service - Mock Implementation

This is a simplified version of the ATS service that doesn't depend on
problematic ML libraries like numpy/scikit-learn on Windows.
It provides basic resume scoring functionality for testing.
"""

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import PyPDF2
import docx
import re
import logging
from typing import Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Simple ATS Service",
    description="Basic resume parsing and scoring service",
    version="1.0.0"
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url}")
    logger.info(f"Headers: {dict(request.headers)}")
    response = await call_next(request)
    return response

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_text_from_pdf(pdf_content: bytes) -> str:
    """Extract text from PDF bytes"""
    try:
        import io
        pdf_file = io.BytesIO(pdf_content)
        pdf_reader = PyPDF2.PdfReader(pdf_file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text()
        return text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")

def extract_text_from_docx(docx_content: bytes) -> str:
    """Extract text from DOCX bytes"""
    try:
        import io
        docx_file = io.BytesIO(docx_content)
        doc = docx.Document(docx_file)
        text = ""
        for paragraph in doc.paragraphs:
            text += paragraph.text + "\n"
        return text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse DOCX: {str(e)}")

def extract_text(file_content: bytes, filename: str) -> str:
    """Extract text from resume file"""
    if filename.lower().endswith('.pdf'):
        return extract_text_from_pdf(file_content)
    elif filename.lower().endswith('.docx'):
        return extract_text_from_docx(file_content)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format. Please use PDF or DOCX.")

def calculate_ats_score(text: str, job_description: Optional[str] = None) -> dict:
    """Calculate a basic ATS score"""
    # Basic scoring criteria
    score = 0
    max_score = 100
    
    # Check for email
    if re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text):
        score += 10
    
    # Check for phone number
    if re.search(r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', text):
        score += 10
    
    # Check for education keywords
    education_keywords = ['bachelor', 'master', 'phd', 'degree', 'university', 'college']
    education_found = sum(1 for keyword in education_keywords if keyword.lower() in text.lower())
    score += min(education_found * 5, 20)
    
    # Check for experience keywords
    experience_keywords = ['experience', 'worked', 'developed', 'managed', 'led', 'created']
    experience_found = sum(1 for keyword in experience_keywords if keyword.lower() in text.lower())
    score += min(experience_found * 3, 20)
    
    # Check for skills
    skill_keywords = ['python', 'javascript', 'react', 'node', 'sql', 'html', 'css', 'java', 'c++']
    skills_found = sum(1 for keyword in skill_keywords if keyword.lower() in text.lower())
    score += min(skills_found * 2, 20)
    
    # Length bonus (completeness)
    if len(text) > 500:
        score += 10
    elif len(text) > 200:
        score += 5
    
    # Job description matching (if provided)
    if job_description:
        job_words = set(job_description.lower().split())
        resume_words = set(text.lower().split())
        common_words = job_words.intersection(resume_words)
        match_score = min(len(common_words) * 2, 20)
        score += match_score
    
    # Ensure score doesn't exceed 100
    score = min(score, max_score)
    
    return {
        "ats_score": score,
        "max_score": max_score,
        "analysis": {
            "has_email": bool(re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text)),
            "has_phone": bool(re.search(r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', text)),
            "education_keywords_found": education_found,
            "experience_keywords_found": experience_found,
            "skills_found": skills_found,
            "text_length": len(text)
        }
    }

@app.post("/analyze")
@app.post("/parse")
async def analyze_resume(
    file: UploadFile = File(...),
    job_description: Optional[str] = Form(None)
):
    """Analyze a resume and return ATS score"""
    try:
        logger.info(f"Received file: {file.filename if file else 'None'}")
        logger.info(f"Received job_description: {job_description}")
        
        # Read file content
        file_content = await file.read()
        logger.info(f"File size: {len(file_content)} bytes")
        
        # Extract text
        text = extract_text(file_content, file.filename)
        logger.info(f"Extracted text length: {len(text)} characters")
        
        # Calculate score
        result = calculate_ats_score(text, job_description)
        logger.info(f"Calculated ATS score: {result['ats_score']}")
        
        # Return in the format expected by the backend
        response = {
            "atsScore": result["ats_score"],  # Backend expects atsScore (camelCase)
            "ats_score": result["ats_score"],  # Keep snake_case for consistency
            "maxScore": result["max_score"],
            "max_score": result["max_score"],
            "parsedSkills": [],  # No advanced parsing in simple version
            "parsingErrors": [],
            "feedback": "Resume processed successfully",
            "breakdown": result["analysis"],
            "success": True,
            "filename": file.filename,
            "file_size": len(file_content),
            "extracted_text_length": len(text),
            "analysis": result["analysis"]
        }
        
        logger.info("Returning successful response")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Simple ATS Service"}

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Simple ATS Service is running", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
