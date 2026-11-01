from datetime import UTC, datetime

from inhotim_path.models import Poi, PoiKind
from inhotim_path.snapshots import read_pois, write_pois

POIS = [
    Poi(id=1, name="Galeria A", kind=PoiKind.GALLERY, lat=-20.1, lng=-44.2, axes=("rosa",)),
    Poi(id=2, name="Obra B", kind=PoiKind.OUTDOOR_WORK, lat=-20.2, lng=-44.3, artists=("X",)),
]


def test_round_trip(tmp_path):
    path = tmp_path / "pois.json"
    assert write_pois(path, POIS, source="test", fetched_at=datetime(2026, 11, 1, tzinfo=UTC))
    assert read_pois(path) == POIS


def test_unchanged_content_is_not_rewritten(tmp_path):
    path = tmp_path / "pois.json"
    write_pois(path, POIS, source="test", fetched_at=datetime(2026, 11, 1, tzinfo=UTC))
    before = path.read_text(encoding="utf-8")
    assert write_pois(path, POIS, source="test") is False
    assert path.read_text(encoding="utf-8") == before  # timestamp untouched


def test_changed_content_is_rewritten(tmp_path):
    path = tmp_path / "pois.json"
    write_pois(path, POIS, source="test")
    assert write_pois(path, POIS[:1], source="test") is True
    assert read_pois(path) == POIS[:1]
