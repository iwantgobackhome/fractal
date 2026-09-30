"""Original geometry regression fixture. Requires reportlab, pypdf, Pillow.
Optional first argument: a Unicode TTF (Windows Arial or Linux DejaVu Sans).
The embedded font subset makes the checked-in PDF independent of system fonts.
"""
from pathlib import Path
import io
import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject, RectangleObject
from PIL import Image, ImageDraw

root = Path(__file__).parent
font = Path(sys.argv[1]) if len(sys.argv) > 1 else next(p for p in [Path('C:/Windows/Fonts/arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')] if p.exists())
pdfmetrics.registerFont(TTFont('FixtureUnicode', str(font)))
symbol = Path('C:/Windows/Fonts/seguisym.ttf')
pdfmetrics.registerFont(TTFont('FixtureSupplementary', str(symbol if symbol.exists() else font)))
out = io.BytesIO()
c = canvas.Canvas(out, pagesize=(612, 792), invariant=1)
c.setFont('Helvetica', 20)
c.drawString(40, 740, 'WWW iii wide thin')
c.setFont('Helvetica', 12)
for row in range(3):
    # Deliberately interleaved PDF content order; geometric order must separate columns.
    c.drawString(40, 680-row*25, f'Left {row+1} alpha prose words')
    c.drawString(330, 680-row*25, f'Right {row+1} beta prose words')
c.showPage()
c.setFont('Helvetica', 20)
c.drawString(85, 650, 'Rotated crop WWW iii')
c.showPage()
c.setFont('Helvetica', 20)
c.saveState()
c.translate(120, 320)
c.rotate(30)
c.drawString(0, 0, 'Angled WWW iii')
c.restoreState()
c.showPage()
image = Image.new('RGB', (500, 300), 'white')
ImageDraw.Draw(image).text((35, 100), 'Raster scan - no selectable PDF text', fill='black')
c.drawImage(ImageReader(image), 50, 350, 500, 300)
c.showPage()
c.setFont('FixtureUnicode', 22)
c.drawString(40, 700, 'Unicode caf\u00e9 e\u0301 \ufb01 \ufb02')
c.drawString(40, 650, '\u05e9\u05dc\u05d5\u05dd')
c.drawString(40, 625, 'ordinary fi')
c.setFont('FixtureSupplementary', 22)
c.drawString(40, 600, '\U0001f600')
c.showPage()
c.save()
reader = PdfReader(out)
writer = PdfWriter()
for i, page in enumerate(reader.pages):
    if i == 1:
        page[NameObject('/Rotate')] = NumberObject(90)
        page[NameObject('/CropBox')] = RectangleObject([60, 80, 560, 720])
    if i == 2:
        page[NameObject('/CropBox')] = RectangleObject([30, 40, 550, 730])
    if i == 4:
        # A single painted fi ligature intentionally maps to two Unicode characters.
        # fl remains U+FB02, verifying disableNormalization preserves original Unicode.
        for f in page['/Resources']['/Font'].values():
            font_obj = f.get_object()
            if '/ToUnicode' in font_obj:
                stream = font_obj['/ToUnicode'].get_object()
                stream.set_data(stream.get_data().replace(b'<FB01>', b'<00660069>').replace(b'<1F600>', b'<D83DDE00>'))
for page in reader.pages:
    writer.add_page(page)
with (root / 'text-layout.pdf').open('wb') as target:
    writer.write(target)
