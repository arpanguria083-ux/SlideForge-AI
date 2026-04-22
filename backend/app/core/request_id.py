import contextvars
import uuid
from fastapi import Request


request_id_ctx = contextvars.ContextVar("request_id", default="")


async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    token = request_id_ctx.set(request_id)
    try:
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response
    finally:
        request_id_ctx.reset(token)
