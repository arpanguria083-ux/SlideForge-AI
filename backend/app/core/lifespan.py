from collections.abc import Awaitable, Callable


async def on_startup(callback: Callable[[], Awaitable[None]]):
    await callback()


async def on_shutdown(callback: Callable[[], Awaitable[None]]):
    await callback()
