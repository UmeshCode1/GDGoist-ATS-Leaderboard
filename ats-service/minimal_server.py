from fastapi import FastAPI
import warnings
warnings.filterwarnings("ignore")

app = FastAPI(title="Minimal ATS Service")

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/score")
async def score_resume(data: dict):
    # Simple mock scoring for testing
    return {
        "atsScore": 75,
        "skills": ["JavaScript", "React", "Node.js"],
        "sections": {
            "education": True,
            "experience": True,
            "skills": True
        },
        "feedback": "Mock resume analysis - ATS service working"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
