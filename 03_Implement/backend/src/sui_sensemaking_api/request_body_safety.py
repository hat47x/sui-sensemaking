from __future__ import annotations

from dataclasses import dataclass

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


MAX_JSON_BODY_NESTING_DEPTH = 64
# SUI-owned Action v1 receiver is intentionally smaller than Document PUT.
MAX_NATIVE_ACTION_JSON_BYTES = 64 * 1024


def _is_json_content_type(scope: Scope) -> bool:
    for name, value in scope.get("headers", []):
        if name.lower() != b"content-type":
            continue
        media_type = value.split(b";", 1)[0].strip().lower()
        return media_type == b"application/json" or media_type.endswith(b"+json")
    return False


@dataclass
class _JsonNestingScanner:
    depth: int = 0
    in_string: bool = False
    escaped: bool = False

    def feed(self, chunk: bytes) -> bool:
        for byte in chunk:
            if self.in_string:
                if self.escaped:
                    self.escaped = False
                elif byte == ord("\\"):
                    self.escaped = True
                elif byte == ord('"'):
                    self.in_string = False
                continue

            if byte == ord('"'):
                self.in_string = True
            elif byte in (ord("{"), ord("[")):
                self.depth += 1
                if self.depth > MAX_JSON_BODY_NESTING_DEPTH:
                    return False
            elif byte in (ord("}"), ord("]")):
                self.depth = max(self.depth - 1, 0)
        return True


class JsonRequestBodySafetyMiddleware:
    """Reject over-deep JSON before Starlette invokes the recursive parser."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _is_json_content_type(scope):
            await self.app(scope, receive, send)
            return

        scanner = _JsonNestingScanner()
        replay_messages: list[Message] = []
        nesting_too_deep = False
        action_too_large = False
        action_bytes = 0
        action_body_limit = (
            scope.get("method") == "POST"
            and scope.get("path", "").startswith("/docs/")
            and scope.get("path", "").endswith("/action-commit")
        )

        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                replay_messages.append(message)
                continue

            if not nesting_too_deep and not action_too_large:
                chunk = message.get("body", b"")
                if action_body_limit:
                    action_bytes += len(chunk)
                    if action_bytes > MAX_NATIVE_ACTION_JSON_BYTES:
                        action_too_large = True
                        replay_messages.clear()
                if not action_too_large:
                    replay_messages.append(message)
                    if not scanner.feed(chunk):
                        nesting_too_deep = True
                        replay_messages.clear()

            if not message.get("more_body", False):
                break

        if action_too_large:
            response = JSONResponse(
                status_code=413,
                content={"protocolVersion": "1", "error": "invalid_action"},
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return

        if nesting_too_deep:
            response = JSONResponse(
                status_code=400,
                content={"detail": {"code": "json_nesting_too_deep"}},
            )
            await response(scope, receive, send)
            return

        replay_index = 0

        async def replay_receive() -> Message:
            nonlocal replay_index
            if replay_index < len(replay_messages):
                message = replay_messages[replay_index]
                replay_index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)
