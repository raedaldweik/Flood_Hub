from datetime import UTC, datetime

from sadd.sim import ZoneParams, build_timeline, distribute_rain, interpolate_ticks


def test_interpolation_preserves_length_and_shape():
    ticks = interpolate_ticks([0, 0, 12, 24, 12, 0], tick_minutes=10)
    assert len(ticks) == 36
    assert max(ticks) == 24 and ticks[21] == 24  # hour-3 midpoint = tick 21
    assert ticks[0] == 0 and ticks[-1] == 0


def test_distribution_is_deterministic_and_bounded():
    city = [0, 2, 10, 24, 8, 1]
    a = distribute_rain(city, {"x": 1.15, "y": 0.9})
    b = distribute_rain(city, {"x": 1.15, "y": 0.9})
    assert a == b
    for zid, factor in (("x", 1.15), ("y", 0.9)):
        for c, v in zip(city, a[zid], strict=True):
            assert 0.7 * factor * c - 1e-9 <= v <= 1.3 * factor * c + 1e-9


def test_timeline_marks_flooding_for_low_drainage_zone_only():
    start = datetime(2024, 4, 16, 0, 0, tzinfo=UTC)
    hourly = [0, 0, 5, 15, 25, 25, 12, 2, 0, 0, 0, 0]
    zones = [
        ZoneParams("najma", 92, 10, 7, True),
        ZoneParams("education_city", 55, 30, 30, False),
    ]
    rain = {z.zone_id: interpolate_ticks(hourly, 10) for z in zones}
    states = build_timeline(start, 10, zones, rain)
    assert len(states) == 2 * 72
    najma = [s for s in states if s.zone_id == "najma"]
    campus = [s for s in states if s.zone_id == "education_city"]
    assert any(s.flooded for s in najma)
    assert not any(s.flooded for s in campus)
    assert max(s.risk for s in najma) >= 80 > max(s.risk for s in campus)
    # water recedes after the rain stops
    assert najma[-1].depth_cm < max(s.depth_cm for s in najma)
    assert najma[-1].ts > najma[0].ts
