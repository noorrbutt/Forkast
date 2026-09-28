"""Downscaling a photo before it is billed to a vision model.

Server side, not client side: the endpoint has to apply regardless of what a
particular build of the app happens to send, and a phone camera shot is
routinely several megabytes at a resolution no dish-identification model
needs. Re-encoding as JPEG at a bounded dimension cuts both the request
payload Groq charges for and the token cost of the image itself, without
meaningfully hurting the model's ability to identify a dish and its portion.
"""

from __future__ import annotations

import io

from PIL import Image, ImageOps

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
    _sniff, which only accepts real JPEG, PNG or WebP signatures, so a failure
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
