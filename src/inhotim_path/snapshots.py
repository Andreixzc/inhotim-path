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
AXES_FILE = "axes.geojson"
OSM_FILE = "osm.json"


def write_snapshot(path: Path, payload: dict[str, Any], *, content_keys: Sequence[str]) -> bool:
    """Write ``payload`` unless its ``content_keys`` equal what's already on disk.

    Metadata such as timestamps is ignored by the comparison. Returns True when written.
    """
    if path.exists():
        try:
            current = read_json(path)
            if all(current[key] == payload[key] for key in content_keys):
                return False
        except (json.JSONDecodeError, KeyError, TypeError):
            pass  # unreadable or different-shaped snapshot: overwrite it
    write_json(path, payload)
    return True


def write_pois(
    path: Path, pois: Sequence[Poi], *, source: str, fetched_at: datetime | None = None
) -> bool:
    items = [p.to_dict() for p in pois]
    payload = {
        "source": source,
        "fetched_at": iso_now(fetched_at),
        "count": len(items),
        "pois": items,
    }
    return write_snapshot(path, payload, content_keys=["pois"])


def read_pois(path: Path) -> list[Poi]:
    return [Poi.from_dict(item) for item in read_json(path)["pois"]]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def iso_now(moment: datetime | None = None) -> str:
    return (moment or datetime.now(UTC)).isoformat(timespec="seconds")
