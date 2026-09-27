"""Static parser checks; never execute the HTML's JavaScript."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

script = Path(__file__).resolve().parents[1] / "scripts" / "extract-risk-lexicon.py"
spec = importlib.util.spec_from_file_location("extract_risk_lexicon", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RiskLexiconExtractionTest(unittest.TestCase):
    def test_extracts_six_columns_and_preserves_duplicate_terms(self):
        html = """<script>
const WORDS_DB = [
  ['保录取', 'education', 'high', '帮助提升录取机会', '第二十四条', '禁止对录取结果做出保证性承诺'],
  ['保录取', 'study_abroad', 'high', '帮助申请', '第二十四条', '禁止对留学录取结果做出保证性承诺']
];
</script>"""
        rows = module.extract(html)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["word"], rows[1]["word"])
        self.assertEqual([row["category"] for row in rows], ["education", "study_abroad"])

    def test_rejects_unrecognized_format(self):
        with self.assertRaisesRegex(ValueError, "WORDS_DB"):
            module.extract("<script>const OTHER = [];</script>")

    def test_default_output_is_the_packaged_runtime_lexicon(self):
        self.assertEqual(module.DEFAULT_OUTPUT, script.parents[1] / "content" / "risk-lexicon.json")


if __name__ == "__main__":
    unittest.main()
