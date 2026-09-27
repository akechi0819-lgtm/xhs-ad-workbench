"""Return an oversized local reference image as a Canvas-ready data URL payload."""
from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image


def prepare(source: Path, max_bytes: int) -> dict[str, object]:
    with Image.open(source) as original:
        original.load()
        for edge, quality in ((1600, 88), (1200, 80), (960, 72)):
            image = original.copy()
            image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                image.save(buffer, format="PNG", optimize=True, compress_level=9)
                mime_type = "image/png"
            else:
                image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True)
                mime_type = "image/jpeg"
            data = buffer.getvalue()
            if len(data) <= max_bytes:
                return {"base64": base64.b64encode(data).decode("ascii"), "mimeType": mime_type,
                        "width": image.width, "height": image.height}
    raise ValueError(f"压缩后仍超过 {max_bytes} 字节：{source}")


if __name__ == "__main__":
    print(json.dumps(prepare(Path(sys.argv[1]), int(sys.argv[2]))))
