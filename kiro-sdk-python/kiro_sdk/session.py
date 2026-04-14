"""Session — routes ACP notifications to the correct async generator."""

from __future__ import annotations

import asyncio
from collections import deque
from typing import AsyncGenerator

from .types import KiroMessage, KiroResultMessage


class _SessionEntry:
    __slots__ = ("acp_session_id", "buffer", "event", "done", "full_text")

    def __init__(self, acp_session_id: str) -> None:
        self.acp_session_id = acp_session_id
        self.buffer: deque[KiroMessage] = deque()
        self.event = asyncio.Event()
        self.done = False
        self.full_text = ""


class SessionRouter:
    def __init__(self) -> None:
        self._sessions: dict[str, _SessionEntry] = {}

    def register(self, acp_session_id: str) -> None:
        self._sessions[acp_session_id] = _SessionEntry(acp_session_id)

    def unregister(self, acp_session_id: str) -> None:
        self._sessions.pop(acp_session_id, None)

    def has(self, acp_session_id: str) -> bool:
        return acp_session_id in self._sessions

    def push(self, acp_session_id: str, message: KiroMessage) -> None:
        entry = self._sessions.get(acp_session_id)
        if not entry:
            return
        if hasattr(message, "content") and message.type == "assistant":
            entry.full_text += message.content
        entry.buffer.append(message)
        entry.event.set()

    def finish(self, acp_session_id: str, is_error: bool = False) -> None:
        entry = self._sessions.get(acp_session_id)
        if not entry:
            return
        entry.buffer.append(KiroResultMessage(
            session_id=acp_session_id,
            is_error=is_error,
            text=entry.full_text,
        ))
        entry.done = True
        entry.event.set()

    async def iterate(self, acp_session_id: str) -> AsyncGenerator[KiroMessage, None]:
        entry = self._sessions.get(acp_session_id)
        if not entry:
            return
        while True:
            while entry.buffer:
                msg = entry.buffer.popleft()
                yield msg
                if msg.type == "result":
                    return
            if entry.done:
                return
            await entry.event.wait()
            entry.event.clear()
