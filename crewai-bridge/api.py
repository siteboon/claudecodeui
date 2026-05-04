"""CrewAI FastAPI bridge — exposes CrewAI crews/agents/tasks as a REST+SSE API."""
from __future__ import annotations

import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_app_dir = os.path.join(_root, "app")
if _app_dir not in sys.path:
    sys.path.insert(0, _app_dir)
os.chdir(_root)

from db_utils import load_entities, initialize_db

app = FastAPI(title="CrewAI Bridge", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=2)
_completed_runs: list[dict[str, Any]] = []


def _crewai_version() -> str:
    try:
        import crewai
        return crewai.__version__
    except Exception:
        return "unknown"


@app.on_event("startup")
async def _startup():
    initialize_db()


@app.get("/health")
async def health():
    return {"status": "ok", "crewai_version": _crewai_version()}


@app.get("/crew/list")
async def crew_list():
    rows = load_entities("crew")
    return [{"id": rid, **data} for rid, data in rows]


@app.get("/agent/list")
async def agent_list():
    rows = load_entities("agent")
    return [{"id": rid, **data} for rid, data in rows]


class CrewRunRequest(BaseModel):
    crew_id: str
    inputs: dict[str, Any] = {}


@app.get("/crew/runs")
async def crew_runs(since: str | None = Query(None)):
    if since:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        return [r for r in _completed_runs if datetime.fromisoformat(r["completed_at"]) > since_dt]
    return _completed_runs


@app.post("/crew/run")
async def crew_run(req: CrewRunRequest):
    rows = load_entities("crew")
    crew_map = {rid: data for rid, data in rows}
    if req.crew_id not in crew_map:
        raise HTTPException(status_code=404, detail=f"Crew '{req.crew_id}' not found")

    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    async def _stream():
        import asyncio
        loop = asyncio.get_event_loop()
        try:
            from my_crew import MyCrew
            crew_data = crew_map[req.crew_id]
            yield f"data: {json.dumps({'type': 'status', 'message': 'Starting crew run...'})}\n\n"
            result = await loop.run_in_executor(
                _executor,
                lambda: MyCrew(crew_data, req.inputs).run(),
            )
            completed_at = datetime.now(timezone.utc).isoformat()
            _completed_runs.append({
                "id": run_id,
                "crew_id": req.crew_id,
                "crew_name": crew_data.get("name", req.crew_id),
                "status": "completed",
                "result": str(result),
                "started_at": started_at,
                "completed_at": completed_at,
            })
            yield f"data: {json.dumps({'type': 'result', 'output': str(result)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
