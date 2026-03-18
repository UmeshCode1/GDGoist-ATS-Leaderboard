print("Testing imports...")

try:
    import fastapi
    print("✅ FastAPI imported")
except Exception as e:
    print(f"❌ FastAPI failed: {e}")

try:
    import nltk
    print("✅ NLTK imported")
except Exception as e:
    print(f"❌ NLTK failed: {e}")

try:
    nltk.download('stopwords', quiet=True)
    print("✅ NLTK stopwords downloaded")
except Exception as e:
    print(f"❌ NLTK download failed: {e}")

try:
    from app.config import APP_TITLE
    print("✅ App config imported")
except Exception as e:
    print(f"❌ App config failed: {e}")

try:
    from app import create_app
    print("✅ App create_app imported")
except Exception as e:
    print(f"❌ App create_app failed: {e}")

print("Done testing.")
