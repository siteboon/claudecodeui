"""
End-to-end integration tests — spawns a real kiro-cli acp process.

Run with:
    pytest tests/test_integration.py -v -s

Requires kiro-cli installed and authenticated.
"""

from __future__ import annotations

import asyncio
import json

import pytest

TIMEOUT = 45


# ---------------------------------------------------------------------------
# Low-level: raw subprocess JSON-RPC (mirrors TS integration tests)
# ---------------------------------------------------------------------------


async def _spawn_acp() -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        "kiro-cli", "acp", "--trust-all-tools",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        limit=10 * 1024 * 1024,
    )


async def _send_rpc(proc: asyncio.subprocess.Process, rid: int, method: str, params: dict) -> None:
    proc.stdin.write((json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}) + "\n").encode())
    await proc.stdin.drain()


async def _collect_lines(proc: asyncio.subprocess.Process, seconds: float) -> list[str]:
    lines: list[str] = []

    async def _reader() -> None:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode("utf-8", errors="replace").strip()
            if decoded:
                lines.append(decoded)

    try:
        await asyncio.wait_for(_reader(), timeout=seconds)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass
    return lines


def _find_response(lines: list[str], rid: int) -> dict | None:
    for line in lines:
        try:
            m = json.loads(line)
            if m.get("id") == rid:
                return m
        except json.JSONDecodeError:
            pass
    return None


@pytest.mark.asyncio
async def test_initialize_returns_agent_capabilities() -> None:
    proc = await _spawn_acp()
    await _send_rpc(proc, 1, "initialize", {
        "protocolVersion": 1,
        "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True},
        "clientInfo": {"name": "kiro-sdk-python-test", "version": "0.1.0"},
    })
    lines = await _collect_lines(proc, 5)
    proc.terminate()

    resp = _find_response(lines, 1)
    assert resp is not None
    result = resp["result"]
    assert result["protocolVersion"] == 1
    assert "Kiro" in result["agentInfo"]["name"]
    assert result["agentCapabilities"]["loadSession"] is True


@pytest.mark.asyncio
async def test_session_new_creates_session() -> None:
    proc = await _spawn_acp()
    lines: list[str] = []

    async def _bg_reader() -> None:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode("utf-8", errors="replace").strip()
            if decoded:
                lines.append(decoded)

    reader_task = asyncio.create_task(_bg_reader())

    await _send_rpc(proc, 1, "initialize", {
        "protocolVersion": 1,
        "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True},
        "clientInfo": {"name": "kiro-sdk-python-test", "version": "0.1.0"},
    })
    await asyncio.sleep(4)
    await _send_rpc(proc, 2, "session/new", {"cwd": "/tmp", "mcpServers": []})
    await asyncio.sleep(12)
    proc.terminate()
    reader_task.cancel()

    resp = _find_response(lines, 2)
    assert resp is not None
    result = resp["result"]
    assert isinstance(result["sessionId"], str)
    assert len(result["sessionId"]) > 0
    assert "modes" in result
    assert "models" in result


@pytest.mark.asyncio
async def test_session_prompt_streams_response() -> None:
    proc = await _spawn_acp()
    lines: list[str] = []

    # Background reader collects all lines throughout the test
    async def _bg_reader() -> None:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode("utf-8", errors="replace").strip()
            if decoded:
                lines.append(decoded)

    reader_task = asyncio.create_task(_bg_reader())

    await _send_rpc(proc, 1, "initialize", {
        "protocolVersion": 1,
        "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True},
        "clientInfo": {"name": "kiro-sdk-python-test", "version": "0.1.0"},
    })
    await asyncio.sleep(4)
    await _send_rpc(proc, 2, "session/new", {"cwd": "/tmp", "mcpServers": []})
    await asyncio.sleep(12)

    session_resp = _find_response(lines, 2)
    assert session_resp is not None
    session_id = session_resp["result"]["sessionId"]

    await _send_rpc(proc, 3, "session/prompt", {
        "sessionId": session_id,
        "prompt": [{"type": "text", "text": "Say exactly: KIRO_SDK_TEST_OK"}],
    })
    await asyncio.sleep(15)
    proc.terminate()
    reader_task.cancel()

    # Verify streaming notifications arrived
    updates = []
    for line in lines:
        try:
            m = json.loads(line)
            if m.get("method") == "session/update":
                updates.append(m)
        except json.JSONDecodeError:
            pass

    text_chunks = [u for u in updates if u.get("params", {}).get("update", {}).get("sessionUpdate") == "agent_message_chunk"]
    assert len(text_chunks) > 0

    full_text = "".join(u["params"]["update"]["content"]["text"] for u in text_chunks if u["params"]["update"].get("content", {}).get("text"))
    assert "KIRO_SDK_TEST_OK" in full_text

    prompt_resp = _find_response(lines, 3)
    assert prompt_resp is not None
    assert prompt_resp["result"]["stopReason"] == "end_turn"


# ---------------------------------------------------------------------------
# High-level: SDK public API (the real e2e test)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sdk_query_end_to_end() -> None:
    """Full round-trip through the Python SDK: query() → stream messages → result."""
    from kiro_sdk import Query, disconnect, query

    conversation = query(prompt="Say exactly: PYTHON_SDK_OK", cwd="/tmp", trust_all_tools=True)

    messages: list = []
    full_text = ""

    async for msg in conversation:
        messages.append(msg)
        if msg.type == "assistant":
            full_text += msg.content

    disconnect()

    # Got at least one assistant chunk and a result
    types_seen = {m.type for m in messages}
    assert "assistant" in types_seen
    assert "result" in types_seen

    # Result message has aggregated text
    result_msg = next(m for m in messages if m.type == "result")
    assert not result_msg.is_error
    assert "PYTHON_SDK_OK" in result_msg.text

    # Streamed text matches
    assert "PYTHON_SDK_OK" in full_text

    # Session ID was set
    assert conversation.session_id is not None
    assert len(conversation.session_id) > 0
