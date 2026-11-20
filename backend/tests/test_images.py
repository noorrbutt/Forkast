"""compress_for_estimation: downscaling a photo before it is billed to Groq."""

from __future__ import annotations

import io

import pytest
from fastapi import HTTPException
from PIL import Image

import app.services.images as images
from app.services.images import (
    JPEG_QUALITY,
    MAX_DIMENSION,
    cached_thumbnail,
    check_upload,
    compress_for_estimation,
    thumbnail,
)


def _photo(width: int, height: int, *, fmt: str = "PNG", exif: bytes | None = None) -> bytes:
    image = Image.new("RGB", (width, height), color=(200, 60, 40))
    buffer = io.BytesIO()
    if exif is not None:
        image.save(buffer, format=fmt, exif=exif)
    else:
        image.save(buffer, format=fmt)
    return buffer.getvalue()


def _decompression_bomb_png(width: int = 20_000, height: int = 20_000) -> bytes:
    buffer = io.BytesIO()
    Image.new("1", (width, height), 0).save(buffer, format="PNG")
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


def test_cached_thumbnail_encodes_only_once_for_the_same_photo_and_edge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _photo(600, 900)
    original_thumbnail = images.thumbnail
    calls = 0

    def counting_thumbnail(source: bytes, max_edge: int) -> tuple[bytes, str] | None:
        nonlocal calls
        calls += 1
        return original_thumbnail(source, max_edge)

    monkeypatch.setattr(images, "thumbnail", counting_thumbnail)

    first = cached_thumbnail("cache-test-photo", data, 300)
    second = cached_thumbnail("cache-test-photo", data, 300)

    assert first == second
    assert calls == 1


def test_thumbnail_declines_a_photo_already_inside_the_bound() -> None:
    assert thumbnail(_photo(200, 100), 300) is None


def test_thumbnail_declines_bytes_it_cannot_decode() -> None:
    assert thumbnail(bytes.fromhex("ffd8ffe0") + b"\x00" * 32, 300) is None


def test_upload_check_still_accepts_signature_only_images() -> None:
    jpeg = bytes.fromhex("ffd8ffe000104a46494600010100000100010000") + b"\x00" * 64

    assert check_upload(jpeg, max_bytes=len(jpeg), noun="Photos") == "image/jpeg"


def test_upload_check_rejects_an_image_over_the_pixel_limit() -> None:
    bomb = _decompression_bomb_png()

    with pytest.raises(HTTPException) as exc_info:
        check_upload(bomb, max_bytes=len(bomb) + 1, noun="Photos")

    assert exc_info.value.status_code == 422


def test_estimation_compression_rejects_an_image_over_the_pixel_limit() -> None:
    with pytest.raises(HTTPException) as exc_info:
        compress_for_estimation(_decompression_bomb_png())

    assert exc_info.value.status_code == 422


def test_thumbnail_declines_an_image_over_the_pixel_limit() -> None:
    assert thumbnail(_decompression_bomb_png(), 300) is None


def test_images_above_the_pixel_limit_but_below_pillow_error_threshold_are_rejected() -> None:
    data = _decompression_bomb_png(5_001, 5_000)

    with pytest.warns(Image.DecompressionBombWarning):
        with pytest.raises(HTTPException) as exc_info:
            check_upload(data, max_bytes=len(data) + 1, noun="Photos")
    assert exc_info.value.status_code == 422

    with pytest.warns(Image.DecompressionBombWarning):
        with pytest.raises(HTTPException) as exc_info:
            compress_for_estimation(data)
    assert exc_info.value.status_code == 422

    with pytest.warns(Image.DecompressionBombWarning):
        assert thumbnail(data, 300) is None
