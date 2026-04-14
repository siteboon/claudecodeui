"""kiro-sdk — public API.

Usage:
    from kiro_sdk import query, disconnect

    async for msg in query(prompt="Hello", cwd="."):
        ...
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, AsyncGenerator

from .acp_transport import AcpTransport
from .session import SessionRouter
from .types import (
    KiroAssistantMessage,
    KiroMessage,
    KiroToolProgressMessage,
    KiroToolUseMessage,
    Options,
)

_transport: AcpTransport | None = None
_router = SessionRouter()


def _get_transport() -> AcpTransport:
    global _transport
    if _transport is None:
        _transport = AcpTransport()
        _transport.set_notification_handler(_handle_notification)
    return _transport


def _handle_notification(method: str, params: dict[str, Any]) -> None:
    if method != "session/update":
        return
    session_id = params.get("sessionId", "")
    update: dict[str, Any] = params.get("update", params)
    kind = update.get("sessionUpdate") or update.get("type") or update.get("kind", "")

    if not session_id or not _router.has(session_id):
        return

    if kind == "agent_message_chunk":
        text = (update.get("content") or {}).get("text", "")
        if text:
            _router.push(session_id, KiroAssistantMessage(content=text, session_id=session_id))
    elif kind == "tool_call":
        _router.push(session_id, KiroToolUseMessage(
            name=update.get("name") or update.get("toolName") or "unknown",
            input=update.get("parameters") or update.get("input") or {},
            id=update.get("id") or update.get("toolUseId") or "",
            status=update.get("status", "running"),
            session_id=session_id,
        ))
    elif kind == "tool_call_update":
        content = update.get("content") or {}
        _router.push(session_id, KiroToolProgressMessage(
            content=content.get("text", "") if isinstance(content, dict) else str(content),
            tool_id=update.get("id") or update.get("toolUseId") or "",
            session_id=session_id,
        ))
    elif kind == "turn_end":
        _router.finish(session_id)


class Query:
    """Wraps the async generator with control methods (interrupt, set_model)."""

    def __init__(self, prompt: str, options: Options) -> None:
        self._prompt = prompt
        self._options = options
        self.session_id: str | None = None
        self._gen: AsyncGenerator[KiroMessage, None] | None = None

    def _ensure_gen(self) -> AsyncGenerator[KiroMessage, None]:
        if self._gen is None:
            self._gen = self._run()
        return self._gen

    def __aiter__(self) -> AsyncGenerator[KiroMessage, None]:
        return self._ensure_gen()

    async def __anext__(self) -> KiroMessage:
        return await self._ensure_gen().__anext__()

    async def _run(self) -> AsyncGenerator[KiroMessage, None]:
        t = _get_transport()
        await t.connect(_build_acp_args(self._options))

        if self._options.resume:
            # Reuse existing ACP session — just send another prompt
            self.session_id = self._options.resume
        else:
            result = await t.send_rpc("session/new", {
                "cwd": self._options.cwd or os.getcwd(),
                "mcpServers": self._options.mcp_servers,
            })
            self.session_id = (result or {}).get("sessionId")
        if not self.session_id:
            raise RuntimeError("Failed to create ACP session")

        _router.register(self.session_id)
        try:
            # Fire the prompt RPC but DON'T await it before yielding.
            # kiro-cli streams notifications BEFORE the RPC response arrives.
            # If we await here, the generator blocks and nothing streams.
            async def _send_prompt() -> None:
                try:
                    prompt_result = await t.send_rpc("session/prompt", {
                        "sessionId": self.session_id,
                        "prompt": [{"type": "text", "text": self._prompt}],
                    })
                    if isinstance(prompt_result, dict) and prompt_result.get("stopReason"):
                        _router.finish(self.session_id)
                except Exception:
                    _router.finish(self.session_id, is_error=True)

            prompt_task = asyncio.ensure_future(_send_prompt())

            async for msg in _router.iterate(self.session_id):
                yield msg

            await prompt_task
        finally:
            _router.unregister(self.session_id)

    async def interrupt(self) -> None:
        if self.session_id:
            t = _get_transport()
            try:
                await t.send_rpc("session/cancel", {"sessionId": self.session_id})
            except Exception:
                pass
            _router.finish(self.session_id, is_error=False)

    async def set_model(self, model: str) -> None:
        t = _get_transport()
        await t.send_rpc("session/set_model", {"model": model})


def query(prompt: str, options: Options | None = None, **kwargs: Any) -> Query:
    """Send a prompt to Kiro and stream back typed messages.

    Returns a Query (async iterable of KiroMessage) with .interrupt() and .set_model().
    """
    if options is None:
        options = Options(**kwargs)
    return Query(prompt, options)


def disconnect() -> None:
    """Shut down the ACP process. Call on application exit."""
    global _transport
    if _transport:
        _transport.disconnect()
        _transport = None


def _build_acp_args(options: Options) -> list[str]:
    args: list[str] = []
    if options.trust_all_tools:
        args.extend(["--trust-all-tools"])
    if options.trust_tools:
        args.extend(["--trust-tools", ",".join(options.trust_tools)])
    if options.agent:
        args.extend(["--agent", options.agent])
    return args
