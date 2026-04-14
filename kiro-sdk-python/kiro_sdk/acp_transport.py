"""ACP Transport — manages the kiro-cli acp subprocess and JSON-RPC 2.0 over stdio."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any, Callable

from .types import AcpInitializeResult

NotificationHandler = Callable[[str, dict[str, Any]], None]


class AcpTransport:
    def __init__(self, kiro_path: str | None = None) -> None:
        self._kiro_path = kiro_path or os.environ.get("KIRO_PATH", "kiro-cli")
        self._process: asyncio.subprocess.Process | None = None
        self._ready = False
        self._rpc_id = 0
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._on_notification: NotificationHandler = lambda m, p: None
        self._init_result: AcpInitializeResult | None = None
        self._reader_task: asyncio.Task[None] | None = None

    def set_notification_handler(self, handler: NotificationHandler) -> None:
        self._on_notification = handler

    async def connect(self, acp_args: list[str] | None = None) -> AcpInitializeResult:
        if self._ready and self._process and self._init_result:
            return self._init_result
        return await self._spawn(acp_args or [])

    async def _spawn(self, acp_args: list[str]) -> AcpInitializeResult:
        args = [self._kiro_path, "acp", *acp_args]
        self._process = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=10 * 1024 * 1024,  # 10 MB — kiro-cli sends large JSON-RPC lines
        )
        self._ready = True
        self._reader_task = asyncio.get_event_loop().create_task(self._read_loop())
        asyncio.get_event_loop().create_task(self._stderr_loop())

        raw = await self.send_rpc("initialize", {
            "protocolVersion": 1,
            "clientCapabilities": {"fs": {"readTextFile": True, "writeTextFile": True}, "terminal": True},
            "clientInfo": {"name": "kiro-sdk-python", "version": "0.1.0"},
        })
        self._init_result = AcpInitializeResult(
            protocol_version=raw.get("protocolVersion", 0),
            agent_capabilities=raw.get("agentCapabilities", {}),
            agent_info=raw.get("agentInfo", {}),
        )
        return self._init_result

    async def send_rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        if not self._process or not self._ready:
            raise RuntimeError("ACP process not ready")
        self._rpc_id += 1
        rid = self._rpc_id
        future: asyncio.Future[Any] = asyncio.get_event_loop().create_future()
        self._pending[rid] = future
        payload = json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}) + "\n"
        self._process.stdin.write(payload.encode())  # type: ignore[union-attr]
        await self._process.stdin.drain()  # type: ignore[union-attr]
        try:
            return await asyncio.wait_for(future, timeout=120)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise TimeoutError(f"RPC timeout for {method}")

    def disconnect(self) -> None:
        if self._process:
            self._process.terminate()
            self._process = None
            self._ready = False
            self._init_result = None
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None

    async def _read_loop(self) -> None:
        assert self._process and self._process.stdout
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                self._handle_line(line.decode())
        except asyncio.CancelledError:
            pass
        finally:
            self._ready = False
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("ACP process exited"))
            self._pending.clear()

    async def _stderr_loop(self) -> None:
        assert self._process and self._process.stderr
        try:
            async for line in self._process.stderr:
                msg = line.decode().strip()
                if msg and "DeprecationWarning" not in msg:
                    print(f"[kiro-sdk:stderr] {msg}", file=sys.stderr)
        except asyncio.CancelledError:
            pass

    def _handle_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            return

        rid = msg.get("id")
        if rid is not None and rid in self._pending:
            fut = self._pending.pop(rid)
            if msg.get("error"):
                fut.set_exception(RuntimeError(msg["error"].get("message", str(msg["error"]))))
            else:
                fut.set_result(msg.get("result"))
            return

        if "method" in msg:
            self._on_notification(msg["method"], msg.get("params", {}))
