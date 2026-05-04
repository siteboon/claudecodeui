"""RED tests for CrewAI FastAPI bridge — Phase 2."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import pytest
from httpx import AsyncClient, ASGITransport

from api import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.anyio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "crewai_version" in body


@pytest.mark.anyio
async def test_crew_list(client):
    resp = await client.get("/crew/list")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    if body:
        crew = body[0]
        assert "id" in crew
        assert "name" in crew


@pytest.mark.anyio
async def test_agent_list(client):
    resp = await client.get("/agent/list")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)


@pytest.mark.anyio
async def test_crew_run_missing_crew_id(client):
    resp = await client.post("/crew/run", json={})
    assert resp.status_code == 422 or resp.status_code == 400


@pytest.mark.anyio
async def test_crew_run_invalid_crew_id(client):
    resp = await client.post("/crew/run", json={"crew_id": "nonexistent", "inputs": {}})
    assert resp.status_code == 404
