"""Domain types shared across the pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class PoiKind(StrEnum):
    """What a point of interest is, from a routing perspective."""

    GALLERY = "gallery"
    OUTDOOR_WORK = "outdoor_work"
    GARDEN = "garden"
    BOTANICAL = "botanical"
    WORK_IN_GALLERY = "work_in_gallery"
    SERVICE = "service"
    EXHIBITION = "exhibition"
    EVENT = "event"
    OTHER = "other"


@dataclass(frozen=True, slots=True)
class Poi:
    """A point on the official map, normalized and deduplicated."""

    id: int
    name: str
    kind: PoiKind
    lat: float
    lng: float
    axes: tuple[str, ...] = ()
    """Official route colors ("eixos") the point belongs to: laranja, amarelo, rosa."""
    artists: tuple[str, ...] = ()
    url: str | None = None
    main_view: bool = True
    """False for works *inside* a gallery: shown only when filtering, not separate stops."""
    flags: tuple[str, ...] = ()
    """Extra markers such as "novas-obras-e-exposicoes" (new) or "obras-e-galerias-reabertas"."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind.value,
            "lat": self.lat,
            "lng": self.lng,
            "axes": list(self.axes),
            "artists": list(self.artists),
            "url": self.url,
            "main_view": self.main_view,
            "flags": list(self.flags),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Poi:
        return cls(
            id=int(data["id"]),
            name=str(data["name"]),
            kind=PoiKind(data["kind"]),
            lat=float(data["lat"]),
            lng=float(data["lng"]),
            axes=tuple(data.get("axes", ())),
            artists=tuple(data.get("artists", ())),
            url=data.get("url"),
            main_view=bool(data.get("main_view", True)),
            flags=tuple(data.get("flags", ())),
        )
