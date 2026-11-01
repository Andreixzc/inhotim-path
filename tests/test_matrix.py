import math

import pytest

from inhotim_path.matrix import walking_matrix
from tests.test_network import build, poi


def test_walking_matrix_is_symmetric_with_paths():
    net = build([poi(1, 60, 90), poi(2, 300, 390), poi(3, 340, 95)])
    matrix = walking_matrix(net, [1, 2, 3])
    for a in (1, 2, 3):
        assert matrix.distance(a, a) == 0
        for b in (1, 2, 3):
            assert matrix.distance(a, b) == pytest.approx(matrix.distance(b, a))
            assert matrix.path(a, b)[0] == net.poi_nodes[a]
            assert matrix.path(a, b)[-1] == net.poi_nodes[b]
    assert matrix.distance(1, 2) == pytest.approx(540, abs=1)
    assert matrix.distance(1, 3) == pytest.approx(10 + 280 + 5, abs=0.5)  # snap + way 1 + snap
    assert not any(math.isinf(d) for row in matrix.meters for d in row)
