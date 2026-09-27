"""Fixed-window rate limiting in Redis (login attempts, tool calls, webhooks)."""

from __future__ import annotations

import time

from redis.asyncio import Redis


class RateLimiter:
    def __init__(self, redis: Redis | None):
        self.redis = redis
        self._local: dict[str, tuple[int, int]] = {}

    async def hit(self, key: str, *, limit: int, window_s: int) -> bool:
        """Count one hit; return True if still within the limit."""
        bucket = int(time.time()) // window_s
        full = f"jarvis:rl:{key}:{bucket}"
        if self.redis is None:
            start, count = self._local.get(full, (bucket, 0))
            count += 1
            self._local[full] = (start, count)
            return count <= limit
        pipe = self.redis.pipeline()
        pipe.incr(full)
        pipe.expire(full, window_s + 1)
        count, _ = await pipe.execute()
        return int(count) <= limit
