"""Read/write the versioned data snapshots in ``data/``.

Snapshots are committed to git: they make ``route`` work offline and give a free changelog of the
collection. Writers skip the write when the content is unchanged, so a refresh that finds nothing
new doesn't produce a timestamp-only diff.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from inhotim_path.models import Poi

DEFAULT_DATA_DIR = Path("data")
POIS_FILE = "pois.json"


def write_pois(
    path: Path, pois: Sequence[Poi], *, source: str, fetched_at: datetime | None = None
) -> bool:
    """Write the POI snapshot. Returns False (and leaves the file alone) if nothing changed."""
    items = [p.to_dict() for p in pois]
    if path.exists():
        try:
            if json.loads(path.read_text(encoding="utf-8")).get("pois") == items:
                return False
        except (json.JSONDecodeError, AttributeError):
            pass  # unreadable snapshot: overwrite it
    payload = {
        "source": source,
        "fetched_at": _iso(fetched_at),
        "count": len(items),
        "pois": items,
    }
    write_json(path, payload)
    return True


def read_pois(path: Path) -> list[Poi]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Poi.from_dict(item) for item in data["pois"]]


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def _iso(moment: datetime | None) -> str:
    return (moment or datetime.now(UTC)).isoformat(timespec="seconds")
