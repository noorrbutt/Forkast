"""Checking an uploaded image, and downscaling a photo before it is billed to a
vision model.

The signature check is shared by the meal photo routes and the avatar route
rather than written twice, so they cannot drift into accepting different files
from each other.

Server side, not client side: the endpoint has to apply regardless of what a
particular build of the app happens to send, and a phone camera shot is
routinely several megabytes at a resolution no dish-identification model
needs. Re-encoding as JPEG at a bounded dimension cuts both the request
payload Groq charges for and the token cost of the image itself, without
meaningfully hurting the model's ability to identify a dish and its portion.
"""

from __future__ import annotations

import io

from fastapi import HTTPException, status
from PIL import Image, ImageOps

# What a phone camera and an image picker actually produce. Checked by magic
# bytes rather than by the declared content type, because the header is whatever
# the client says it is and this content is served straight back to other users
# of the same account.
# Written as hex rather than as escaped byte strings. These signatures
# contain CR, LF and SUB, which do not survive being copied through a text
# editor intact, and a silently mangled signature here would reject every
# valid PNG.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (bytes.fromhex("ffd8ff"), "image/jpeg"),
    (bytes.fromhex("89504e470d0a1a0a"), "image/png"),
    (bytes.fromhex("52494646"), "image/webp"),
)


def sniff(data: bytes) -> str | None:
    """The real type of these bytes, or None if it is not an image we accept."""
    for prefix, content_type in _MAGIC:
        if not data.startswith(prefix):
            continue
        # RIFF alone is any RIFF container, including audio. Only WEBP counts.
        if content_type == "image/webp" and data[8:12] != bytes.fromhex("57454250"):
            return None
        return content_type
    return None


def check_upload(data: bytes, *, max_bytes: int, noun: str) -> str:
    """The content type of an uploaded image, or the 4xx that refuses it.

    The caller reads with one byte of headroom, so a file exactly on the limit
    passes and anything over it is caught here rather than by a CHECK
    constraint, which would surface as a 500. `noun` is what the messages call
    the file ("Photos", "Avatars").
    """
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"{noun} must be {max_bytes // 1024} KB or smaller.",
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That file was empty.",
        )
    content_type = sniff(data)
    if content_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"{noun} must be JPEG, PNG or WebP.",
        )
    return content_type


# Long enough that a dish, its portion and its plate are all still legible;
# short enough that a 4000px camera photo becomes a few hundred KB rather than
# several megabytes. The model is identifying a dish, not reading text on a
# menu, so detail past this point buys nothing.
MAX_DIMENSION = 1024

# High enough that JPEG blocking artifacts do not obscure what a dish is,
# low enough that the size win from downscaling is not immediately undone by
# an unnecessarily high bitrate.
JPEG_QUALITY = 82


def compress_for_estimation(data: bytes) -> bytes:
    """Re-encode `data` as a downscaled JPEG, ready to send to a vision model.

    Never raises on a malformed image: the caller has already run this past
    sniff, which only accepts real JPEG, PNG or WebP signatures, so a failure
    here means Pillow could not decode bytes that passed that check, which is
    a corrupt or truncated upload rather than a well-formed one this function
    should have handled. That is reported the same way a transport failure
    to Groq is, by the caller, rather than crashing the request with a raw
    Pillow exception.
    """
    with Image.open(io.BytesIO(data)) as image:
        # EXIF orientation is stripped by the resize below (Pillow does not
        # carry EXIF through a resave by default), so it has to be baked into
        # the pixels first or a photo taken in portrait comes out sideways.
        image = ImageOps.exif_transpose(image) or image
        image = image.convert("RGB")
        image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buffer.getvalue()


# The bounds a caller may ask a served photo to be shrunk to. The floor keeps
# a typo from producing a smear; the ceiling is MAX_DIMENSION because asking
# for more than that is asking for the original.
MIN_THUMBNAIL_EDGE = 64
MAX_THUMBNAIL_EDGE = MAX_DIMENSION


def thumbnail(data: bytes, max_edge: int) -> tuple[bytes, str] | None:
    """`data` re-encoded as a JPEG whose longest edge is at most `max_edge`.

    For a photo shown at tile size, such as the strip of today's meals on
    Home, where the full stored image is several times the bytes the screen
    can draw. Same pipeline as compress_for_estimation, so a portrait photo
    stays upright here too.

    None when there is nothing to gain: the photo is already within the bound,
    or Pillow cannot decode bytes that passed sniff. The caller serves the
    original either way, which is always a correct answer, just a larger one.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            if max(image.size) <= max_edge:
                return None
            image = ImageOps.exif_transpose(image) or image
            image = image.convert("RGB")
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            return buffer.getvalue(), "image/jpeg"
    except (OSError, ValueError):
        return None
