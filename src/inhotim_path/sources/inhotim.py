"""Inhotim's official map: the marker feed behind https://www.inhotim.org.br/mapa/.

The website's Google Map loads its pins from ``admin-ajax.php?action=get_markers``. We read the
same feed, then normalize and deduplicate it into :class:`~inhotim_path.models.Poi` objects.
See ``docs/data-sources.md`` for the field-by-field description and the quirks handled here.
"""

from __future__ import annotations

import dataclasses
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from html.parser import HTMLParser
from typing import Any

import httpx

from inhotim_path.models import Poi, PoiKind
from inhotim_path.sources import SourceError

BASE_URL = "https://www.inhotim.org.br"
MAP_PAGE_URL = f"{BASE_URL}/mapa/"
MARKERS_URL = f"{BASE_URL}/wp-admin/admin-ajax.php?action=get_markers"

#: Category slug -> kind, in precedence order: the first match wins when a marker has several
#: (e.g. ``["galeria", "obra-em-galeria"]`` is a gallery).
GROUP_PRECEDENCE: tuple[tuple[str, PoiKind], ...] = (
    ("galeria", PoiKind.GALLERY),
    ("artista", PoiKind.GALLERY),  # an artist pinned on the map = their dedicated gallery
    ("obras-a-ceu-aberto", PoiKind.OUTDOOR_WORK),
    ("jardim-tematico", PoiKind.GARDEN),
    ("destaque-botanico", PoiKind.BOTANICAL),
    ("exposicoes", PoiKind.EXHIBITION),
    ("obra-em-galeria", PoiKind.WORK_IN_GALLERY),
)
SERVICES_GROUP = "it_services"
#: The English version of the site uses English color names.
AXIS_ALIASES = {"orange": "laranja", "yellow": "amarelo", "pink": "rosa"}

_REQUIRED_FIELDS = frozenset({"id", "lat", "lng", "content"})


# --------------------------------------------------------------------------- network


def fetch_markers(client: httpx.Client) -> list[dict[str, Any]]:
    """Download the raw marker list (one request)."""
    response = client.get(MARKERS_URL)
    response.raise_for_status()
    return extract_markers(response.json())


# --------------------------------------------------------------------------- parsing


def extract_markers(payload: Any) -> list[dict[str, Any]]:
    """Validate the ``get_markers`` envelope and return its marker list."""
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise SourceError("get_markers: unexpected payload (expected {'success': true, ...})")
    markers = (payload.get("data") or {}).get("markers")
    if not isinstance(markers, list) or not markers:
        raise SourceError("get_markers: 'data.markers' is missing or empty")
    malformed = [m for m in markers if not isinstance(m, dict) or not m.keys() >= _REQUIRED_FIELDS]
    if malformed:
        raise SourceError(
            f"get_markers: {len(malformed)} markers lack one of {sorted(_REQUIRED_FIELDS)}"
        )
    return markers


def parse_marker(raw: Mapping[str, Any]) -> Poi:
    """Turn one raw marker into a :class:`Poi` (no deduplication)."""
    info = _InfoWindow.parse(raw.get("content") or "")
    poi_id = int(raw["id"])
    url = info.title_href or info.first_href
    return Poi(
        id=poi_id,
        name=info.title or f"#{poi_id}",
        kind=classify(raw.get("group"), url),
        lat=float(raw["lat"]),
        lng=float(raw["lng"]),
        axes=_axes(raw.get("axis")),
        artists=_link_texts(raw.get("artists_names")) or tuple(info.subtitles),
        url=url,
        main_view=bool(raw.get("main_view", True)),
        flags=_flags(raw.get("filters")),
    )


def classify(group: Any, url: str | None = None) -> PoiKind:
    """Map the feed's ``group`` field (list of slugs, a string, or null) to a :class:`PoiKind`."""
    if group == SERVICES_GROUP:
        return PoiKind.SERVICE
    if isinstance(group, list):
        slugs = {str(g) for g in group if g}
    else:
        slugs = {group} if isinstance(group, str) and group else set()
    for slug, kind in GROUP_PRECEDENCE:
        if slug in slugs:
            return kind
    if not slugs and url and "/eventos/" in url:
        return PoiKind.EVENT
    return PoiKind.OTHER


def normalize_markers(raw_markers: Iterable[Mapping[str, Any]]) -> list[Poi]:
    """Parse and deduplicate markers.

    The feed repeats most ids (probably once per translation/category), sometimes with different
    coordinates or ``main_view``. For each id we keep the ``main_view=True`` entry when there is one
    and merge the axes, artists and flags of all copies. The result does not depend on the feed's
    order, so snapshots only change when the data does.
    """
    by_id: dict[int, list[Poi]] = {}
    for raw in raw_markers:
        poi = parse_marker(raw)
        by_id.setdefault(poi.id, []).append(poi)
    merged = (_merge(copies) for copies in by_id.values())
    return sorted(merged, key=lambda p: (p.kind.value, p.name.casefold(), p.id))


# --------------------------------------------------------------------------- helpers


def _merge(copies: list[Poi]) -> Poi:
    # Primary copy: visible on the main map first, then the most repeated position, then a stable
    # tie-break, so the choice never depends on the feed's order.
    position_count = Counter((p.lat, p.lng) for p in copies)
    primary = min(
        copies,
        key=lambda p: (not p.main_view, -position_count[(p.lat, p.lng)], p.lat, p.lng, p.name),
    )
    return dataclasses.replace(
        primary,
        axes=_sorted_union(p.axes for p in copies),
        artists=_sorted_union(p.artists for p in copies),
        flags=_sorted_union(p.flags for p in copies),
        main_view=any(p.main_view for p in copies),
    )


def _sorted_union(groups: Iterable[tuple[str, ...]]) -> tuple[str, ...]:
    return tuple(sorted({item for group in groups for item in group}))


def _union(groups: Iterable[tuple[str, ...]]) -> tuple[str, ...]:
    """Order-preserving union."""
    return tuple(dict.fromkeys(item for group in groups for item in group))


def _axes(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    colors = (AXIS_ALIASES.get(str(v).strip().lower(), str(v).strip().lower()) for v in value)
    return _union([tuple(c for c in colors if c)])


def _flags(value: Any) -> tuple[str, ...]:
    if not isinstance(value, dict):
        return ()
    return _union(tuple(v) if isinstance(v, list) else (str(v),) for v in value.values())


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _link_texts(fragment: Any) -> tuple[str, ...]:
    if not isinstance(fragment, str) or not fragment.strip():
        return ()
    parser = _Links()
    parser.feed(fragment)
    parser.close()
    return _union([tuple(t for t in parser.texts if t)])


class _Links(HTMLParser):
    """Collects the text of every ``<a>`` in an HTML fragment."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.texts: list[str] = []
        self._depth = 0
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._depth += 1
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._depth:
            self._depth -= 1
            self.texts.append(_squash("".join(self._buf)))

    def handle_data(self, data: str) -> None:
        if self._depth:
            self._buf.append(data)


class _InfoWindow(HTMLParser):
    """Parses a marker's info window.

    Shape (2026-11)::

        <div class="infowindow__content">
          <div class="infowindow__img"><a href="ITEM_URL"><img …></a></div>
          <h3><a href="CATEGORY_URL">Category</a></h3>
          <h2><a href="ARTIST_URL">Artist</a></h2>          (optional)
          <h1><a href="ITEM_URL">Title</a></h1>
        </div>
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title: str | None = None
        self.title_href: str | None = None
        self.first_href: str | None = None
        self.subtitles: list[str] = []
        self._heading: str | None = None
        self._href: str | None = None
        self._buf: list[str] = []

    @classmethod
    def parse(cls, fragment: str) -> _InfoWindow:
        parser = cls()
        parser.feed(fragment)
        parser.close()
        return parser

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"h1", "h2", "h3"}:
            self._heading, self._href, self._buf = tag, None, []
        elif tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.first_href = self.first_href or href
                if self._heading and self._href is None:
                    self._href = href

    def handle_endtag(self, tag: str) -> None:
        if tag != self._heading:
            return
        text = _squash("".join(self._buf))
        if tag == "h1" and self.title is None:
            self.title, self.title_href = text or None, self._href
        elif tag == "h2" and text:
            self.subtitles.append(text)
        self._heading = None

    def handle_data(self, data: str) -> None:
        if self._heading:
            self._buf.append(data)
