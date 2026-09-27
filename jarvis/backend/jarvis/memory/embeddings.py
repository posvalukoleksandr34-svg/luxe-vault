"""Embedding providers.

Default is `local`: a multilingual sentence-transformer run on CPU through ONNX
(fastembed) — private, no API key, good Russian/English quality, 384 dims.
Swap to Voyage or OpenAI via JARVIS_EMBEDDING_PROVIDER; vectors are stored per
model, so switching re-indexes instead of mixing spaces (`jarvis reembed`).
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
import time
from pathlib import Path

import httpx

from jarvis.core.logging import log


class Embedder:
    model: str = "none"
    dim: int = 0

    @property
    def enabled(self) -> bool:
        return self.dim > 0

    async def embed(self, texts: list[str], *, kind: str = "document") -> list[list[float]] | None:
        return None


class NullEmbedder(Embedder):
    pass


class HashEmbedder(Embedder):
    """Deterministic bag-of-character-trigrams hashing. For tests and as a no-dependency fallback."""

    def __init__(self, dim: int = 256):
        self.dim = dim
        self.model = f"hash-trigram-{dim}"

    async def embed(self, texts: list[str], *, kind: str = "document") -> list[list[float]]:
        out = []
        for text in texts:
            vec = [0.0] * self.dim
            norm = re.sub(r"\s+", " ", text.lower())
            for word in re.findall(r"\w+", norm):
                padded = f"#{word}#"
                for i in range(len(padded) - 2):
                    h = int(hashlib.md5(padded[i : i + 3].encode()).hexdigest()[:8], 16)
                    vec[h % self.dim] += 1.0
            n = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / n for v in vec])
        return out


class LocalEmbedder(Embedder):
    RETRY_AFTER_S = 1800.0

    def __init__(self, model: str | None, cache_dir: Path):
        self.model = model or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        self.cache_dir = cache_dir
        self._impl = None
        self._lock = asyncio.Lock()
        self._failed_until = 0.0
        self._dim = 384 if "MiniLM" in self.model else 768

    @property
    def dim(self) -> int:  # type: ignore[override]
        # Circuit breaker: while the model cannot be loaded (e.g. no access to huggingface.co), report
        # "disabled" so memory falls back to full-text + trigram search instantly instead of stalling.
        return 0 if time.monotonic() < self._failed_until else self._dim

    @dim.setter
    def dim(self, value: int) -> None:
        self._dim = value

    async def _load(self):
        async with self._lock:
            if self._impl is None:
                if time.monotonic() < self._failed_until:
                    raise RuntimeError("embedding model unavailable (cooling down)")

                def _make():
                    from fastembed import TextEmbedding  # optional dependency

                    return TextEmbedding(model_name=self.model, cache_dir=str(self.cache_dir))

                try:
                    self._impl = await asyncio.to_thread(_make)
                except Exception as exc:
                    self._failed_until = time.monotonic() + self.RETRY_AFTER_S
                    log.warning("embeddings.unavailable", model=self.model, error=str(exc)[:200],
                                retry_in_s=self.RETRY_AFTER_S,
                                hint="memory uses keyword search meanwhile; set HF_ENDPOINT for a mirror")
                    raise
                log.info("embeddings.loaded", model=self.model)
        return self._impl

    async def embed(self, texts: list[str], *, kind: str = "document") -> list[list[float]] | None:
        impl = await self._load()
        vectors = await asyncio.to_thread(lambda: [v.tolist() for v in impl.embed(texts)])
        if vectors:
            self.dim = len(vectors[0])
        return vectors


class HTTPEmbedder(Embedder):
    def __init__(self, *, url: str, api_key: str, model: str, dim: int, style: str):
        self.url, self.api_key, self.model, self.dim, self.style = url, api_key, model, dim, style

    async def embed(self, texts: list[str], *, kind: str = "document") -> list[list[float]] | None:
        body: dict = {"input": texts, "model": self.model}
        if self.style == "voyage":
            body["input_type"] = "query" if kind == "query" else "document"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(self.url, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
            r.raise_for_status()
            data = r.json()["data"]
        return [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]


def build_embedder(provider: str, *, model: str | None, data_dir: Path, voyage_key: str | None,
                   openai_key: str | None) -> Embedder:
    if provider == "local":
        try:
            import fastembed  # noqa: F401
        except ImportError:
            log.warning("embeddings.local_unavailable", hint="pip install jarvis[local-embeddings]; using keyword search only")
            return NullEmbedder()
        return LocalEmbedder(model, data_dir / "models")
    if provider == "voyage" and voyage_key:
        return HTTPEmbedder(url="https://api.voyageai.com/v1/embeddings", api_key=voyage_key,
                            model=model or "voyage-3.5", dim=1024, style="voyage")
    if provider == "openai" and openai_key:
        return HTTPEmbedder(url="https://api.openai.com/v1/embeddings", api_key=openai_key,
                            model=model or "text-embedding-3-small", dim=1536, style="openai")
    if provider == "hash":
        return HashEmbedder()
    return NullEmbedder()
