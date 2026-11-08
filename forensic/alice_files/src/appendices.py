"""Visible expert access log; no embedded files or hidden machine-readable data."""

import io

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

from evidence import access_rows


def create_appendices():
    width, height = A4
    margin, content_width = 49, width - 98
    out = io.BytesIO()
    pdf = Canvas(out, pagesize=A4, invariant=1)

    def header(number, title, subtitle):
        pdf.setFillColorRGB(0.974, 0.971, 0.954)
        pdf.rect(0, 0, width, height, stroke=0, fill=1)
        pdf.setFillColorRGB(0.18, 0.20, 0.19)
        pdf.setFont("DV-Bold", 9.6)
        pdf.drawString(margin, height - 45, "КОМИССИЯ ПО РЕВИЗИИ / МАТЕРИАЛЫ ЭКСПЕРТА")
        pdf.setFont("DV", 7.3)
        pdf.drawRightString(width - margin, height - 45, "СК-17")
        pdf.setStrokeColorRGB(0.48, 0.49, 0.47)
        pdf.setLineWidth(0.5)
        pdf.line(margin, height - 57, width - margin, height - 57)
        pdf.setFont("DV", 8)
        pdf.drawString(margin, height - 76, f"ПРИЛОЖЕНИЕ {number} · ДОБАВЛЕНО ПОСЛЕ ИЗЪЯТИЯ")
        pdf.drawRightString(width - margin, height - 76, "18.09.2026")
        pdf.setFont("DV-Bold", 14)
        pdf.drawString(margin, height - 106, title)
        pdf.setFont("DV", 8.5)
        pdf.drawString(margin, height - 128, subtitle)

    def footer(number, page_count):
        pdf.setStrokeColorRGB(0.62, 0.62, 0.59)
        pdf.line(margin, 49, width - margin, 49)
        pdf.setFillColorRGB(0.4, 0.4, 0.38)
        pdf.setFont("DV", 7.1)
        pdf.drawString(margin, 35, "СК-17 · Справочный материал эксперта · Не часть исходного доклада")
        pdf.drawRightString(width - margin, 35, f"Журнал · Лист {number} из {page_count}")

    rows = access_rows()
    rows_per_page = 46
    page_count = (len(rows) + rows_per_page - 1) // rows_per_page
    columns = [margin + 6, margin + 67, margin + 114, margin + 279, margin + 365, margin + 432]
    labels = ["Время", "Пропуск", "Фамилия / surname", "Зона номер", "Событие", "Результат"]
    for page_index in range(page_count):
        header(1, "Журнал контроля доступа", "17.09.2026 · Интервал 00:00-04:00 · Все отметки UTC+07:00")
        y, row_height = height - 153, 13
        pdf.setFillColorRGB(0.87, 0.88, 0.85)
        pdf.rect(margin, y - 17, content_width, 20, stroke=0, fill=1)
        pdf.setFillColorRGB(0.18, 0.20, 0.19)
        pdf.setFont("DV-Bold", 7.8)
        for x, value in zip(columns, labels):
            pdf.drawString(x, y - 10, value)
        y -= 27
        page_rows = rows[page_index * rows_per_page:(page_index + 1) * rows_per_page]
        for i, row in enumerate(page_rows):
            if i % 2 == 0:
                pdf.setFillColorRGB(0.955, 0.953, 0.935)
                pdf.rect(margin, y - 3, content_width, row_height, stroke=0, fill=1)
            pdf.setFillColorRGB(0.18, 0.20, 0.19)
            pdf.setFont("DV", 8)
            values = [row["timestamp"][11:19], row["badge_id"], row["surname"] + " / " + row["surname_ascii"],
                      row["zone"], row["event"], row["result"]]
            for x, value in zip(columns, values):
                pdf.drawString(x, y, value)
            y -= row_height
        if y < 59:
            raise ValueError(f"Access log page {page_index + 1} overflow: {y}")
        footer(page_index + 1, page_count)
        pdf.showPage()
    pdf.save()
    return out.getvalue()
