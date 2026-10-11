"""Generate explicitly synthetic parser fixtures; optional development tool (reportlab/Pillow)."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parent.parent
font_path = root / 'public/fonts/NotoSans-Regular.ttf'
pdfmetrics.registerFont(TTFont('NotoSans', str(font_path)))
for stem in ['DEMO-commercial-invoice-022', 'DEMO-packing-list-022', 'DEMO-bill-of-lading-022']:
    lines = (root / f'fixtures/{stem}.txt').read_text().splitlines()
    doc = canvas.Canvas(str(root / f'fixtures/{stem}.pdf'), pagesize=A4)
    doc.setTitle(stem + ' - SYNTHETIC')
    doc.setFont('NotoSans', 10)
    y = 792
    for line in lines:
        doc.drawString(42, y, line)
        y -= 22
    doc.save()
img = Image.new('RGB', (1240, 1754), 'white')
draw = ImageDraw.Draw(img)
font = ImageFont.truetype(str(font_path), 25)
lines = (root / 'fixtures/DEMO-commercial-invoice-022.txt').read_text().splitlines()
for i, line in enumerate(['SYNTHETIC SCAN - OCR NOT CONNECTED', ''] + lines):
    draw.text((65, 70 + i * 45), line, fill='#24332f', font=font)
img.save(root / 'fixtures/DEMO-scanned-invoice.png')
doc = canvas.Canvas(str(root / 'fixtures/DEMO-scan-with-blank-page.pdf'), pagesize=A4)
doc.drawImage(str(root / 'fixtures/DEMO-scanned-invoice.png'), 0, 0, width=A4[0], height=A4[1])
doc.showPage()
doc.showPage()
doc.save()
print('Generated 3 text PDFs, a scan image, and a 2-page scan/blank PDF; all synthetic.')
