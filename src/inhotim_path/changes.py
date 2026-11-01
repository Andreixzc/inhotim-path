"""What changed in the collection between two POI snapshots, for ``fetch``'s report."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from inhotim_path.geo import haversine_m
from inhotim_path.models import Poi

#: Smaller moves are map noise (a pin nudged on the official map), not news.
MOVED_M = 15.0


@dataclass(frozen=True)
class PoiChange:
    old: Poi
    new: Poi
    what: tuple[str, ...]
    """``renamed``, ``kind``, ``moved``, or the name of another field that changed."""


@dataclass(frozen=True)
class PoiChanges:
    added: tuple[Poi, ...] = ()
    removed: tuple[Poi, ...] = ()
    changed: tuple[PoiChange, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.added or self.removed or self.changed)


def diff_pois(old: Sequence[Poi], new: Sequence[Poi]) -> PoiChanges:
    before = {p.id: p for p in old}
    after = {p.id: p for p in new}
    changed = []
    for poi_id in sorted(before.keys() & after.keys()):
        what = _what_changed(before[poi_id], after[poi_id])
        if what:
            changed.append(PoiChange(before[poi_id], after[poi_id], what))
    return PoiChanges(
        added=_by_name(after[i] for i in after.keys() - before.keys()),
        removed=_by_name(before[i] for i in before.keys() - after.keys()),
        changed=tuple(changed),
    )


def describe(changes: PoiChanges) -> list[str]:
    """One line per change: ``+`` new on the map, ``-`` gone, ``~`` changed."""
    lines = [f"+ {p.name} ({p.kind.value})" for p in changes.added]
    lines += [f"- {p.name} ({p.kind.value})" for p in changes.removed]
    for change in changes.changed:
        old, new = change.old, change.new
        details = []
        for what in change.what:
            if what == "renamed":
                details.append(f"renamed from {old.name!r}")
            elif what == "kind":
                details.append(f"{old.kind.value} -> {new.kind.value}")
            elif what == "moved":
                details.append(f"moved {haversine_m((old.lat, old.lng), (new.lat, new.lng)):.0f} m")
            else:
                details.append(f"{what} changed")
        lines.append(f"~ {new.name}: {', '.join(details)}")
    return lines


def summary(changes: PoiChanges) -> str:
    return (
        f"{len(changes.added)} added, {len(changes.removed)} removed, "
        f"{len(changes.changed)} changed"
    )


def _what_changed(old: Poi, new: Poi) -> tuple[str, ...]:
    what = []
    if old.name != new.name:
        what.append("renamed")
    if old.kind != new.kind:
        what.append("kind")
    if haversine_m((old.lat, old.lng), (new.lat, new.lng)) >= MOVED_M:
        what.append("moved")
    before, after = old.to_dict(), new.to_dict()
    what += [
        key
        for key in before
        if key not in ("name", "kind", "lat", "lng") and before[key] != after[key]
    ]
    return tuple(what)


def _by_name(pois: Iterable[Poi]) -> tuple[Poi, ...]:
    return tuple(sorted(pois, key=lambda p: (p.name, p.id)))
