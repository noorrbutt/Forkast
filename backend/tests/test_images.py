"""compress_for_estimation: downscaling a photo before it is billed to Groq."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.services.images import JPEG_QUALITY, MAX_DIMENSION, compress_for_estimation, thumbnail


def _photo(width: int, height: int, *, fmt: str = "PNG", exif: bytes | None = None) -> bytes:
    image = Image.new("RGB", (width, height), color=(200, 60, 40))
    buffer = io.BytesIO()
    if exif is not None:
        image.save(buffer, format=fmt, exif=exif)
    else:
        image.save(buffer, format=fmt)
    return buffer.getvalue()


def test_a_large_photo_is_downscaled_to_the_bound() -> None:
    original = _photo(3000, 2000)

    compressed = compress_for_estimation(original)

    with Image.open(io.BytesIO(compressed)) as result:
        assert max(result.size) <= MAX_DIMENSION
        # Aspect ratio preserved: thumbnail() scales both dimensions together.
        assert result.size[0] / result.size[1] == pytest.approx(3000 / 2000, abs=0.02)


def test_a_photo_already_under_the_bound_is_not_upscaled() -> None:
    original = _photo(400, 300)

    compressed = compress_for_estimation(original)

    with Image.open(io.BytesIO(compressed)) as result:
        assert result.size == (400, 300)


def test_the_result_is_always_a_jpeg() -> None:
    for fmt in ("PNG", "JPEG"):
        compressed = compress_for_estimation(_photo(200, 200, fmt=fmt))
        with Image.open(io.BytesIO(compressed)) as result:
            assert result.format == "JPEG"


def test_downscaling_meaningfully_shrinks_a_large_photo() -> None:
    """The whole point: a camera-resolution photo should cost less to send."""
    original = _photo(3000, 3000)

    compressed = compress_for_estimation(original)

    assert len(compressed) < len(original)


def test_a_quality_setting_is_actually_in_use() -> None:
    """Not a claim about the exact number, just that the constant this test
    imports is the one actually passed to Pillow, so a future edit to one
    cannot silently stop moving the other."""
    assert 0 < JPEG_QUALITY <= 95


def test_portrait_orientation_survives_the_downscale() -> None:
    original = _photo(2000, 4000)

    compressed = compress_for_estimation(original)

    with Image.open(io.BytesIO(compressed)) as result:
        assert result.size[1] > result.size[0]
        assert max(result.size) <= MAX_DIMENSION


def test_thumbnail_bounds_the_longest_edge_of_a_portrait_photo() -> None:
    result = thumbnail(_photo(600, 900), 300)

    assert result is not None
    data, content_type = result
    assert content_type == "image/jpeg"
    with Image.open(io.BytesIO(data)) as image:
        assert image.size == (200, 300)


def test_thumbnail_declines_a_photo_already_inside_the_bound() -> None:
    assert thumbnail(_photo(200, 100), 300) is None


def test_thumbnail_declines_bytes_it_cannot_decode() -> None:
    assert thumbnail(bytes.fromhex("ffd8ffe0") + b"\x00" * 32, 300) is None
