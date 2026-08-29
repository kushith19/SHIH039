from fastapi import FastAPI
from src.api.routes import health, commander
from src.config.settings import settings

app = FastAPI(
    title=settings.app_name,
    description="AI Commander V1 Microservice API",
    version="1.0.0",
)

# Include routers
app.include_router(health.router)
app.include_router(commander.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host=settings.host, port=settings.port, reload=(settings.app_env == "development"))
