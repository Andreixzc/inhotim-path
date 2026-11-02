import json
from pathlib import Path

import pytest

from inhotim_path.models import PoiKind
from inhotim_path.sources import SourceError
from inhotim_path.sources.inhotim import classify, extract_markers, normalize_markers

FIXTURE = Path(__file__).parent / "fixtures" / "get_markers_sample.json"
ITEM = "https://www.inhotim.org.br/item-do-acervo"


@pytest.fixture
def pois():
    markers = extract_markers(json.loads(FIXTURE.read_text(encoding="utf-8")))
    return {p.id: p for p in normalize_markers(markers)}


def test_deduplicates_by_id(pois):
    assert len(pois) == 8  # 10 raw markers, 2 duplicated ids


def test_parses_title_url_and_unescapes_entities(pois):
    praca = pois[3890]
    assert praca.name == "Galeria Praça"
    assert praca.url == "https://www.inhotim.org.br/item-do-acervo/galeria-praca/"
    assert praca.kind is PoiKind.GALLERY
    assert praca.axes == ("amarelo",)


def test_prefers_main_view_copy_and_merges_axes_and_flags(pois):
    rivane = pois[3476]
    assert (rivane.lat, rivane.lng) == (-20.123834, -44.219952)  # the main_view=True copy
    assert rivane.main_view is True
    assert set(rivane.axes) == {"rosa", "amarelo"}
    assert rivane.flags == ("obras-e-galerias-reabertas",)
    assert rivane.kind is PoiKind.GALLERY  # "galeria" wins over "obra-em-galeria"


def test_artists_and_axis_aliases(pois):
    beam_drop = pois[3236]
    assert beam_drop.kind is PoiKind.OUTDOOR_WORK
    assert beam_drop.artists == ("Chris Burden",)
    assert beam_drop.axes == ("laranja",)  # "orange" (English site) normalized


def test_kinds(pois):
    assert pois[4241].kind is PoiKind.SERVICE
    assert pois[4241].axes == ()  # axis "" -> no axes
    assert pois[3700].kind is PoiKind.WORK_IN_GALLERY
    assert pois[3700].main_view is False
    assert pois[17243].kind is PoiKind.EVENT
    assert pois[3226].kind is PoiKind.GALLERY  # artist pinned on the map = their gallery
    assert pois[3226].artists == ("Yayoi Kusama",)  # ... and theirs, though the feed credits no one
    assert pois[4060].kind is PoiKind.BOTANICAL


def test_output_is_sorted_for_stable_diffs():
    markers = extract_markers(json.loads(FIXTURE.read_text(encoding="utf-8")))
    result = normalize_markers(markers)
    assert result == normalize_markers(list(reversed(markers)))
    keys = [(p.kind.value, p.name.casefold(), p.id) for p in result]
    assert keys == sorted(keys)


@pytest.mark.parametrize(
    ("group", "url", "expected"),
    [
        ("it_services", None, PoiKind.SERVICE),
        (["jardim-tematico"], None, PoiKind.GARDEN),
        (["obras-a-ceu-aberto"], None, PoiKind.OUTDOOR_WORK),
        (["obras-a-ceu-aberto"], f"{ITEM}/beam-drop-inhotim-chris-burden/", PoiKind.OUTDOOR_WORK),
        # Filed under outdoor works, but its page is a gallery's: Doug Aitken's Sonic Pavilion.
        (["obras-a-ceu-aberto"], f"{ITEM}/galeria-doug-aitken/", PoiKind.GALLERY),
        (["obras-a-ceu-aberto"], f"{ITEM}/galeria-doug-aitken", PoiKind.GALLERY),
        (["obras-a-ceu-aberto"], f"{ITEM}/galeria-doug-aitken/?lang=en", PoiKind.GALLERY),
        (["obra-em-galeria"], f"{ITEM}/galeria-x/", PoiKind.WORK_IN_GALLERY),
        (None, "https://www.inhotim.org.br/eventos/atelie-galeria-lago/", PoiKind.EVENT),
        (["exposicoes"], None, PoiKind.EXHIBITION),
        (None, "https://www.inhotim.org.br/eventos/x/", PoiKind.EVENT),
        (None, "https://www.inhotim.org.br/outra-coisa/", PoiKind.OTHER),
        (["slug-desconhecido"], None, PoiKind.OTHER),
        ("", None, PoiKind.OTHER),
    ],
)
def test_classify(group, url, expected):
    assert classify(group, url) is expected


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {"success": False},
        {"success": True, "data": {"markers": []}},
        {"success": True, "data": {"markers": [{"id": 1, "lat": 0}]}},
    ],
)
def test_rejects_unexpected_payloads(payload):
    with pytest.raises(SourceError):
        extract_markers(payload)


# --------------------------------------------------------------------------- map assets

MAP_HTML = (
    '<div id="map" data-zoom="16" data-center-lat="-20.1242111" '
    'data-axis="https://www.inhotim.org.br/wp-content/themes/inhotim/dist/images/eixos_5f2dbdef.svg">'
    "</div>"
    '<script src="https://www.inhotim.org.br/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>'
    '<script src="https://www.inhotim.org.br/wp-content/themes/inhotim/dist/scripts/main_34271e46.js">'
    "</script>"
)
THEME_JS = (
    "f=new google.maps.Marker({position:{lat:1,lng:2}});var r=new google.maps.Map(e,c),"
    "s=new google.maps.LatLng(-20.12903525,-44.22784743),"
    "l=new google.maps.LatLng(-20.11823726,-44.21704688),h=new google.maps.LatLngBounds(s,l);"
)


def test_parse_axes_svg_url():
    from inhotim_path.sources.inhotim import parse_axes_svg_url

    assert parse_axes_svg_url(MAP_HTML).endswith("/images/eixos_5f2dbdef.svg")
    with pytest.raises(SourceError):
        parse_axes_svg_url("<div id='map'></div>")


def test_parse_theme_script_url():
    from inhotim_path.sources.inhotim import parse_theme_script_url

    assert parse_theme_script_url(MAP_HTML).endswith("/dist/scripts/main_34271e46.js")
    assert parse_theme_script_url("<html></html>") is None


def test_parse_overlay_bounds():
    from inhotim_path.sources.inhotim import FALLBACK_OVERLAY_BOUNDS, parse_overlay_bounds

    assert parse_overlay_bounds(THEME_JS) == FALLBACK_OVERLAY_BOUNDS
    assert parse_overlay_bounds("new google.maps.LatLng(1,2)") is None


def test_text_is_normalized_to_composed_unicode():
    from inhotim_path.sources.inhotim import parse_marker

    decomposed = "sem título"  # "i" + combining acute, as found in the live feed
    raw = {
        "id": 1,
        "lat": -20.12,
        "lng": -44.22,
        "content": f"<div><h1><a href='https://x/item-do-acervo/a/'>{decomposed}</a></h1></div>",
        "group": ["obras-a-ceu-aberto"],
        "artists_names": "<a href='https://x'>Amilcar de Castro</a>",
    }
    assert parse_marker(raw).name == "sem título"
