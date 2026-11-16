"""Server-Sent Events: actualizaciones en vivo (trabajos, detecciones, clips, estado del directo)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import Principal, current_principal
from app.services.bus import encode, get_bus

router = APIRouter(tags=["events"])


@router.get("/events")
async def stream(request: Request, p: Principal = Depends(current_principal)):
    ws = str(p.workspace_id)

    async def gen():
        yield f"data: {encode('hello', {'workspace_id': ws})}\n\n"
        sub = get_bus().subscribe(ws).__aiter__()
        pending = None
        try:
            while not await request.is_disconnected():
                if pending is None:
                    pending = asyncio.ensure_future(sub.__anext__())
                done, _ = await asyncio.wait({pending}, timeout=15)
                if not done:
                    yield ": keepalive\n\n"
                    continue
                msg = pending.result()
                pending = None
                yield f"data: {msg}\n\n"
        finally:
            if pending is not None:
                pending.cancel()
            await sub.aclose()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
