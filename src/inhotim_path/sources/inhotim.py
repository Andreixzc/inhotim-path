"""Inhotim's official map: the marker feed behind https://www.inhotim.org.br/mapa/.

The website's Google Map loads its pins from ``admin-ajax.php?action=get_markers``. We read the
same feed, then normalize and deduplicate it into :class:`~inhotim_path.models.Poi` objects.
See ``docs/data-sources.md`` for the field-by-field description and the quirks handled here.
"""

from __future__ import annotations

import dataclasses
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

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
#: The map files a few artist galleries under outdoor works (e.g. Doug Aitken's Sonic Pavilion), but
#: their pages in the collection are named ``galeria-<artist>``, like every other gallery's.
GALLERY_PAGE_RE = re.compile(r"/item-do-acervo/galeria-[^/]+/?$")
#: The English version of the site uses English color names.
AXIS_ALIASES = {"orange": "laranja", "yellow": "amarelo", "pink": "rosa"}

_REQUIRED_FIELDS = frozenset({"id", "lat", "lng", "content"})

#: Overlay bounds (SW, NE) of the routes SVG as found in the theme bundle on 2026-11-01.
#: Used only if they can't be parsed from the live bundle.
FALLBACK_OVERLAY_BOUNDS: tuple[tuple[float, float], tuple[float, float]] = (
    (-20.12903525, -44.22784743),
    (-20.11823726, -44.21704688),
)

_DATA_AXIS_RE = re.compile(r'\bdata-axis="([^"]+)"')
_THEME_SCRIPT_RE = re.compile(r'<script[^>]+src="([^"]*/themes/inhotim/[^"]*/main[^"/]*\.js)"')
_LATLNG = r"new google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)"
_ASSIGN = r"\s*,\s*[\w$]+\s*=\s*"
_OVERLAY_BOUNDS_RE = re.compile(
    _LATLNG + _ASSIGN + _LATLNG + _ASSIGN + r"new google\.maps\.LatLngBounds\("
)


@dataclass(frozen=True)
class MapAssets:
    """Where the routes SVG lives and which geographic box it is stretched over."""

    axes_svg_url: str
    sw: tuple[float, float]
    ne: tuple[float, float]
    bounds_from: str
    """"theme-js" when parsed from the live bundle, "fallback" otherwise."""


# --------------------------------------------------------------------------- network


def fetch_markers(client: httpx.Client) -> list[dict[str, Any]]:
    """Download the raw marker list (one request)."""
    response = client.get(MARKERS_URL)
    response.raise_for_status()
    return extract_markers(response.json())


def fetch_map_assets(client: httpx.Client) -> MapAssets:
    """Find the routes SVG URL (map page) and its overlay bounds (theme bundle). Two requests."""
    page = client.get(MAP_PAGE_URL)
    page.raise_for_status()
    svg_url = urljoin(MAP_PAGE_URL, parse_axes_svg_url(page.text))
    (sw, ne), bounds_from = FALLBACK_OVERLAY_BOUNDS, "fallback"
    script_url = parse_theme_script_url(page.text)
    if script_url:
        bundle = client.get(urljoin(MAP_PAGE_URL, script_url))
        if bundle.is_success and (parsed := parse_overlay_bounds(bundle.text)):
            (sw, ne), bounds_from = parsed, "theme-js"
    return MapAssets(axes_svg_url=svg_url, sw=sw, ne=ne, bounds_from=bounds_from)


def fetch_text(client: httpx.Client, url: str) -> str:
    response = client.get(url)
    response.raise_for_status()
    return response.text


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


def parse_axes_svg_url(map_html: str) -> str:
    match = _DATA_AXIS_RE.search(map_html)
    if not match:
        raise SourceError("map page: no #map[data-axis] attribute (routes SVG URL)")
    return match.group(1)


def parse_theme_script_url(map_html: str) -> str | None:
    match = _THEME_SCRIPT_RE.search(map_html)
    return match.group(1) if match else None


def parse_overlay_bounds(
    theme_js: str,
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """Extract ``(sw, ne)`` from ``new LatLng(..), x = new LatLng(..), y = new LatLngBounds(``."""
    match = _OVERLAY_BOUNDS_RE.search(theme_js)
    if not match:
        return None
    lat1, lng1, lat2, lng2 = map(float, match.groups())
    sw = (min(lat1, lat2), min(lng1, lng2))
    ne = (max(lat1, lat2), max(lng1, lng2))
    if sw[0] == ne[0] or sw[1] == ne[1]:
        return None
    return sw, ne


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
    """Map the feed's ``group`` field (list of slugs, a string, or null) to a :class:`PoiKind`.

    The item's page (``url``) settles what the categories don't: an outdoor work whose page is a
    gallery's (:data:`GALLERY_PAGE_RE`) is a gallery, and a marker with no category is an event when
    its page is one.
    """
    if group == SERVICES_GROUP:
        return PoiKind.SERVICE
    if isinstance(group, list):
        slugs = {str(g) for g in group if g}
    else:
        slugs = {group} if isinstance(group, str) and group else set()
    for slug, kind in GROUP_PRECEDENCE:
        if slug in slugs:
            if kind is PoiKind.OUTDOOR_WORK and url and GALLERY_PAGE_RE.search(urlsplit(url).path):
                return PoiKind.GALLERY
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
    """Collapse whitespace and use composed Unicode (the feed mixes "í" and "i" + U+0301)."""
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text).strip())


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
