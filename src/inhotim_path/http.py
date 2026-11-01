"""HTTP client shared by all sources: identifies itself and never hangs forever."""

from __future__ import annotations

import httpx

from inhotim_path import USER_AGENT


def make_client(timeout: float = 60.0) -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
        follow_redirects=True,
    )
