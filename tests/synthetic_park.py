"""A tiny park with named POIs on the ``test_network`` layout, shared by planner and CLI tests.

(200,380) ───── (300,380) ·5 Jardim Pictórico
    │
(200,300) ·4 Sem título (Amílcar de Castro)
    │                                   ·7 Galeria Longe (395,250): > 150 m from any path
(50,100) ── (200,100) ── (350,100)
·1 Recepção  ·2 Praça (+6 inside)  ·3 Lago      (POIs sit 5 m south of the path)
"""

from pathlib import Path

from inhotim_path import snapshots
from inhotim_path.models import Poi, PoiKind
from inhotim_path.planner import ParkData
from inhotim_path.sources import axes, osm
from inhotim_path.sources.osm import OsmPark
from tests.test_network import AXES, PARK, WAYS, at


def poi(poi_id: int, name: str, kind: PoiKind, x: float, y: float, **extra) -> Poi:
    lat, lng = at(x, y)
    return Poi(id=poi_id, name=name, kind=kind, lat=lat, lng=lng, **extra)


POIS = (
    poi(1, "Recepção", PoiKind.SERVICE, 50, 95),
    poi(2, "Galeria Praça", PoiKind.GALLERY, 200, 95, url="https://example.org/praca"),
    poi(3, "Galeria Lago", PoiKind.GALLERY, 350, 95),
    poi(4, "Sem título", PoiKind.OUTDOOR_WORK, 205, 300, artists=("Amílcar de Castro",)),
    poi(5, "Jardim Pictórico", PoiKind.GARDEN, 300, 385),
    poi(6, "Obra interna", PoiKind.WORK_IN_GALLERY, 200, 96, main_view=False),
    poi(7, "Galeria Longe", PoiKind.GALLERY, 395, 250),
)


def park_data() -> ParkData:
    park = OsmPark(relation_id=1, boundary=PARK, ways=WAYS)
    return ParkData(pois=POIS, park=park, axes=tuple(AXES))


def write_snapshots(data_dir: Path) -> None:
    data = park_data()
    snapshots.write_pois(data_dir / snapshots.POIS_FILE, data.pois, source="test")
    snapshots.write_json(
        data_dir / snapshots.OSM_FILE, osm.to_snapshot(data.park, fetched_at="2026-11-01T00:00Z")
    )
    snapshots.write_json(
        data_dir / snapshots.AXES_FILE, axes.to_feature_collection(list(data.axes), source="test")
    )
