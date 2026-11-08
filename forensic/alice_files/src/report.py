"""Typeset the eight-page confidential report and rasterize its print master."""

import io
import json
from pathlib import Path
from xml.sax.saxutils import escape

import pypdfium2 as pdfium
from PIL import ImageDraw
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

HERE = Path(__file__).resolve().parent


def create_report() -> bytes:
    for name, file in (("DV", "DejaVuSans.ttf"), ("DV-Bold", "DejaVuSans-Bold.ttf")):
        pdfmetrics.registerFont(TTFont(name, str(HERE / "assets" / file)))
    text = (HERE / "confidential_report.md").read_text(encoding="utf-8")
    sections = text.split("<!-- PAGEBREAK -->")
    assert len(sections) == 8
    width, height = A4
    margin, body_width = 49, width - 98
    out = io.BytesIO()
    pdf = Canvas(out, pagesize=A4, invariant=1)
    pdf.setTitle("Материалы предварительной ревизии · Лаборатория X")
    pdf.setAuthor("Комиссия по ревизии архива")
    for index, section in enumerate(sections, 1):
        blocks = [b.strip() for b in section.strip().split("\n\n") if b.strip()]
        heading = next(b[3:] for b in blocks if b.startswith("## "))
        paragraphs = [b for b in blocks if not b.startswith("#")]
        pdf.setFillColorRGB(0.18, 0.20, 0.19)
        pdf.setFont("DV-Bold", 10.5)
        pdf.drawString(margin, height - 45, "ЛАБОРАТОРИЯ X / АРХИВНАЯ КОМИССИЯ")
        pdf.setFont("DV", 7.4)
        pdf.drawRightString(width - margin, height - 45, "КОНФИДЕНЦИАЛЬНО")
        pdf.setStrokeColorRGB(0.48, 0.49, 0.47)
        pdf.setLineWidth(0.5)
        pdf.line(margin, height - 57, width - margin, height - 57)
        pdf.setFont("DV", 8)
        pdf.drawString(margin, height - 76, "МАТЕРИАЛЫ ПРЕДВАРИТЕЛЬНОЙ РЕВИЗИИ")
        pdf.drawRightString(width - margin, height - 76, "РВ-26/09 · 16.09.2026")
        title = Paragraph(escape(heading), ParagraphStyle("heading", fontName="DV-Bold", fontSize=14, leading=18))
        _, title_height = title.wrap(body_width, 60)
        title.drawOn(pdf, margin, height - 99 - title_height)
        top, bottom = height - 99 - title_height - 17, 65
        available = top - bottom
        # Fixed type size on all pages; small leading adjustments fill each sheet.
        base_style = ParagraphStyle("body", fontName="DV", fontSize=9.2, leading=14,
                                    alignment=TA_JUSTIFY, firstLineIndent=13)
        probes = [Paragraph(escape(p), base_style) for p in paragraphs]
        lines = sum(round(p.wrap(body_width, 1000)[1] / 14) for p in probes)
        gap = 5
        leading = (available - gap * (len(paragraphs) - 1)) / lines
        if not 10.6 <= leading <= 14.5:
            raise ValueError(f"Page {index}: unsuitable leading {leading:.2f}, {lines} lines")
        style = ParagraphStyle("body-final", parent=base_style, leading=leading)
        y = top
        for paragraph in paragraphs:
            block = Paragraph(escape(paragraph), style)
            _, block_height = block.wrap(body_width, available)
            y -= block_height
            block.drawOn(pdf, margin, y)
            y -= gap
        assert abs(y + gap - bottom) < 0.1
        pdf.setStrokeColorRGB(0.62, 0.62, 0.59)
        pdf.line(margin, 49, width - margin, 49)
        pdf.setFont("DV", 7.1)
        pdf.setFillColorRGB(0.40, 0.40, 0.38)
        pdf.drawString(margin, 35, "РВ-26/09 · Внутреннее обращение · Передача по описи")
        pdf.drawRightString(width - margin, 35, f"Лист {index} из 8")
        pdf.showPage()
        print(f"Report page {index}: {len(' '.join(paragraphs))} chars, {lines} lines, leading {leading:.2f}", flush=True)
    pdf.save()
    return out.getvalue()


def redaction_boxes(page, phrases):
    """Locate complete words/line fragments in the private print master."""
    text = page.get_textpage()
    boxes = []
    try:
        for phrase in phrases:
            search = text.search(phrase, match_case=True)
            found = search.get_next()
            search.close()
            if found is None:
                raise ValueError(f"Redaction phrase not found: {phrase}")
            start, count = found
            for i in range(text.count_rects(start, count)):
                left, bottom, right, top = text.get_rect(i)
                # Pad glyph bounds so no antialiased edge survives.
                boxes.append((left - 0.9, bottom - 1.0, right + 0.9, top + 1.0))
    finally:
        text.close()
    return boxes


def render_pages(data, redact=False):
    doc = pdfium.PdfDocument(data)
    redactions = json.loads((HERE / "redactions.json").read_text()) if redact else {}
    try:
        for index, page in enumerate(doc, 1):
            bitmap = page.render(scale=300 / 72)
            im = bitmap.to_pil().convert("L").resize((2480, 3508))
            if redact:
                draw = ImageDraw.Draw(im)
                width, height = page.get_size()
                for left, bottom, right, top in redaction_boxes(page, redactions.get(str(index), [])):
                    draw.rectangle((int(left * 2480 / width), int((height - top) * 3508 / height),
                                    int(right * 2480 / width) + 1, int((height - bottom) * 3508 / height) + 1), fill=0)
            bitmap.close()
            page.close()
            yield im
    finally:
        doc.close()


if __name__ == "__main__":
    target = HERE.parent / "output" / "pdf" / "confidential_report.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(create_report())
    print(target)
