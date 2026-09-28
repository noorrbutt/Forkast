"""Synthetic photos for the demo account's food log.

Not real photography -- there is no photo library this repo has the rights to
ship, and fetching real ones from the internet at seed time would make the
demo account's contents depend on a network call and on images nobody here
chose. What this draws instead is a small, deliberately abstract "plate of
food": a background, a plate, and a cluster of coloured blobs standing in for
whatever is on it. It exists to populate the diary's photo-card treatment
(see history.tsx) with something that is unmistakably a photo slot rather
than an empty one, not to look like a dish anyone could name.

Deterministic, the same reasoning DeterministicAIService and the rest of this
seed package already follow: hashed off the dish name, so the same dish comes
out the same picture on every run and a reseed does not shuffle every photo
in the diary.
"""

from __future__ import annotations

import hashlib
import io
import random

from PIL import Image, ImageDraw

# 640 square. Big enough to look like a real upload once resized through the
# app's own compress_for_estimation path (see services/images.py) would
# resize it anyway, small enough that ninety-odd of these stay a trivial
# amount of database size.
SIZE = 640
JPEG_QUALITY = 78

# Warm, muted table/surface tones a plate might actually sit on. Deliberately
# not from theme/tokens.ts: that palette is UI chrome and is asserted by
# contrast.test.ts against other UI chrome, not against photo content a real
# camera would produce, so borrowing it here would tie a demo photo's colours
# to a contrast budget they have nothing to do with.
_SURFACES = [
    (58, 47, 38),
    (71, 58, 48),
    (46, 40, 36),
    (90, 74, 56),
]
_PLATE = (238, 231, 219)

# Two small palettes standing in for "looks fried or sauced" against "looks
# grilled or fresh", the same is_junk split the rest of the app already
# draws on, so a junk-flagged dish's photo leans toward the golden/browned
# tones a fried or heavily sauced plate actually has and a clean one leans
# toward greens and char.
_JUNK_TONES = [(196, 129, 42), (214, 158, 61), (168, 92, 40), (222, 178, 92)]
_CLEAN_TONES = [(107, 133, 79), (74, 99, 61), (156, 92, 58), (133, 148, 92)]


def demo_food_photo(dish_name: str, is_junk: bool) -> tuple[bytes, str]:
    """A deterministic (bytes, content_type) pair for one dish name."""
    seed = int(hashlib.sha256(dish_name.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)

    image = Image.new("RGB", (SIZE, SIZE), color=rng.choice(_SURFACES))
    draw = ImageDraw.Draw(image)

    margin = SIZE // 8
    draw.ellipse([margin, margin, SIZE - margin, SIZE - margin], fill=_PLATE)

    palette = _JUNK_TONES if is_junk else _CLEAN_TONES
    inset = margin + SIZE // 12
    for _ in range(rng.randint(3, 6)):
        cx = rng.randint(inset, SIZE - inset)
        cy = rng.randint(inset, SIZE - inset)
        r = rng.randint(SIZE // 12, SIZE // 6)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rng.choice(palette))

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue(), "image/jpeg"
