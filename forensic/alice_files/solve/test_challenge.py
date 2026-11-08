"""Regression checks for forensic failures that would invalidate the challenge."""

import json
import sys
import unittest
from datetime import datetime
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from pypdf import PdfReader

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "src"))
from build import encode_docucolor  # noqa: E402
from report import redaction_boxes, render_pages  # noqa: E402
from solve import ACCESS_LOG, decode_grid, identify  # noqa: E402


class ChallengeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pdf = HERE.parent / "public" / "scan_03.pdf"
        cls.rows = ACCESS_LOG
        cls.mic = {"serial": "00483729", "printer_time": "2026-09-16T20:06"}

    def test_any_single_dot_error_is_detected(self):
        grid = encode_docucolor("00654321", datetime(2005, 10, 13, 9, 45))
        self.assertEqual(int(grid[0].sum() % 2), 0)
        for row, col in np.ndindex(grid.shape):
            damaged = grid.copy()
            damaged[row, col] ^= 1
            with self.subTest(row=row, col=col), self.assertRaises(ValueError):
                decode_grid(damaged)

    def test_date_rollover_and_denied_entry(self):
        person = identify(self.mic, self.rows)
        self.assertEqual(person["local_time"], "2026-09-17T03:06+07:00")
        self.assertEqual(person["badge_id"], "B031")
        self.assertEqual(person["answer"], "nskctf{lebedeva_0306}")

    def test_another_person_partway_through_minute_is_ambiguous(self):
        rows = [dict(r) for r in self.rows]
        for row in rows:
            if row["result"] == "DENIED" and row["badge_id"] == "B044":
                row["result"] = "GRANTED"
                row["timestamp"] = "2026-09-17T03:06:19+07:00"
        with self.assertRaisesRegex(ValueError, "Ambiguous employee"):
            identify(self.mic, rows)

    def test_single_pdf_has_no_recoverable_redacted_text(self):
        self.assertEqual({p.name for p in self.pdf.parent.iterdir() if not p.name.startswith('.')}, {"scan_03.pdf"})
        reader = PdfReader(self.pdf)
        self.assertEqual(len(reader.pages), 11)
        self.assertFalse(reader.attachments)
        self.assertFalse(reader.get_fields())
        self.assertNotIn("/OCProperties", reader.trailer["/Root"])
        for page in reader.pages[:8]:
            self.assertFalse(page.extract_text().strip())
            self.assertFalse(page.get("/Annots"))
            self.assertEqual(len(page.images), 1)
            self.assertNotIn(b" Tj", page.get_contents().get_data())
            self.assertNotIn(b" TJ", page.get_contents().get_data())
            im = page.images[0].image
            self.assertEqual(im.size, (2480, 3508))
            self.assertEqual(im.mode, "RGB")
            self.assertFalse(im.getexif())
        for number, page in enumerate(reader.pages[8:], 1):
            self.assertIn("ПРИЛОЖЕНИЕ", page.extract_text())
            self.assertIn(f"Лист {number} из 3", page.extract_text())
        public_text = "".join(p.extract_text() for p in reader.pages)
        self.assertNotIn("nskctf{lebedeva_0306}", public_text)
        self.assertIn("Зона номер", public_text)
        for old_label in ("Реестр оборудования", "Xerox", "DocuColor", "PRINT_F", "BUILDING"):
            self.assertNotIn(old_label, public_text)
        for print_minute in ("03:06", "20:06"):
            self.assertNotIn(print_minute, public_text)
            self.assertNotIn(print_minute, str(reader.metadata))
            self.assertTrue(all(print_minute not in row["timestamp"] for row in self.rows))
        self.assertNotIn(b"nskctf{lebedeva_0306}", self.pdf.read_bytes())
        for secret in ("00483729", "20:06", "lebedeva", "Лебедева"):
            self.assertNotIn(secret, str(reader.metadata))

    def test_redactions_replace_all_underlying_pixels(self):
        master = (HERE.parent / "output/pdf/confidential_report.pdf").read_bytes()
        redactions = json.loads((HERE.parent / "src/redactions.json").read_text())
        doc = pdfium.PdfDocument(master)
        try:
            for index, image in enumerate(render_pages(master, redact=True), 1):
                page = doc[index - 1]
                width, height = page.get_size()
                phrases = redactions[str(index)]
                self.assertGreaterEqual(len(phrases), 3)
                for left, bottom, right, top in redaction_boxes(page, phrases):
                    crop = image.crop((int(left * 2480 / width), int((height - top) * 3508 / height),
                                       int(right * 2480 / width) + 1, int((height - bottom) * 3508 / height) + 1))
                    self.assertEqual(crop.getextrema(), (0, 0))
                page.close()
        finally:
            doc.close()

    def test_report_has_eight_substantial_pages_and_no_future_reveal(self):
        reader = PdfReader(HERE.parent / "output" / "pdf" / "confidential_report.pdf")
        self.assertEqual(len(reader.pages), 8)
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text()
            self.assertGreater(len(text), 4000)
            self.assertIn(f"Лист {i} из 8", text)
            self.assertNotIn("mr. X", text)
            self.assertNotIn("flag{", text)
            for hint in ("сканирован", "принтер", "серийный номер", "синий канал",
                         "жёлтые точки", "цветовой канал", "docucolor", "jpeg",
                         "контраст", "время печати", "часовой пояс", "журнал доступа",
                         "отказ в доступе", "осветлять", "поворачивать", "увеличивать"):
                self.assertNotIn(hint, text.lower())


if __name__ == "__main__":
    unittest.main()
