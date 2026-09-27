"""Verify oversized references are converted without modifying the user's original file."""
from __future__ import annotations

import base64
import json
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


class CanvasImageTest(unittest.TestCase):
    def test_large_png_is_reduced_below_canvas_reference_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "reference.png"
            image = Image.frombytes("RGB", (1000, 1000), random.Random(7).randbytes(3_000_000))
            image.save(source, format="PNG")
            original = source.read_bytes()
            self.assertGreater(len(original), 2_097_152)
            helper = Path(__file__).resolve().parents[1] / "scripts" / "prepare-canvas-image.py"
            output = subprocess.check_output([sys.executable, str(helper), str(source), "1900000"], text=True)
            result = json.loads(output)
            self.assertLessEqual(len(base64.b64decode(result["base64"])), 1_900_000)
            self.assertEqual((result["width"], result["height"]), (1000, 1000))
            self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
