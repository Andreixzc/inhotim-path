from dataclasses import replace

from inhotim_path.changes import describe, diff_pois, summary
from inhotim_path.models import Poi, PoiKind

GALLERY = Poi(id=1, name="Galeria Praça", kind=PoiKind.GALLERY, lat=-20.12, lng=-44.22)
WORK = Poi(id=2, name="Beam Drop", kind=PoiKind.OUTDOOR_WORK, lat=-20.13, lng=-44.21)
GARDEN = Poi(id=3, name="Jardim Pictórico", kind=PoiKind.GARDEN, lat=-20.125, lng=-44.215)


def test_same_collection_in_another_order_has_no_changes():
    changes = diff_pois([GALLERY, WORK], [WORK, GALLERY])
    assert not changes
    assert describe(changes) == []


def test_added_and_removed():
    changes = diff_pois([GALLERY, WORK], [GALLERY, GARDEN])
    assert changes.added == (GARDEN,)
    assert changes.removed == (WORK,)
    assert summary(changes) == "1 added, 1 removed, 0 changed"
    assert describe(changes) == ["+ Jardim Pictórico (garden)", "- Beam Drop (outdoor_work)"]


def test_renamed_recategorized_and_moved():
    new = replace(GALLERY, name="Galeria Nova", kind=PoiKind.EXHIBITION, lat=GALLERY.lat + 0.001)
    changes = diff_pois([GALLERY], [new])
    (change,) = changes.changed
    assert change.what == ("renamed", "kind", "moved")
    assert describe(changes) == [
        "~ Galeria Nova: renamed from 'Galeria Praça', gallery -> exhibition, moved 111 m"
    ]


def test_a_nudged_pin_is_not_news():
    assert not diff_pois([GALLERY], [replace(GALLERY, lat=GALLERY.lat + 0.00005)])  # ~6 m


def test_other_fields_are_named():
    new = replace(WORK, artists=("Chris Burden",), url="https://example.org/beam-drop")
    changes = diff_pois([WORK], [new])
    assert changes.changed[0].what == ("artists", "url")
    assert describe(changes) == ["~ Beam Drop: artists changed, url changed"]
