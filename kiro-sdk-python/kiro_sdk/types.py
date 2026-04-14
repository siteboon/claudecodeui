"""kiro-sdk type definitions. Mirrors the TypeScript SDK types."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class Options:
    cwd: str | None = None
    resume: str | None = None
    model: str | None = None
    agent: str | None = None
    trust_all_tools: bool = False
    trust_tools: list[str] = field(default_factory=list)
    mcp_servers: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class KiroAssistantMessage:
    type: Literal["assistant"] = "assistant"
    content: str = ""
    session_id: str = ""


@dataclass
class KiroToolUseMessage:
    type: Literal["tool_use"] = "tool_use"
    name: str = ""
    input: dict[str, Any] = field(default_factory=dict)
    id: str = ""
    status: Literal["running", "completed", "error"] = "running"
    session_id: str = ""


@dataclass
class KiroToolProgressMessage:
    type: Literal["tool_progress"] = "tool_progress"
    content: str = ""
    tool_id: str = ""
    session_id: str = ""


@dataclass
class KiroResultMessage:
    type: Literal["result"] = "result"
    session_id: str = ""
    is_error: bool = False
    text: str = ""


KiroMessage = KiroAssistantMessage | KiroToolUseMessage | KiroToolProgressMessage | KiroResultMessage


@dataclass
class AcpInitializeResult:
    protocol_version: int = 0
    agent_capabilities: dict[str, Any] = field(default_factory=dict)
    agent_info: dict[str, str] = field(default_factory=dict)


@dataclass
class AcpSessionResult:
    session_id: str = ""
