"""Render and verify selections independently with MuPDF.
Usage: python -X utf8 verify-text-layout.py layout.json output-directory
layout.json is the array of extractTextPage results for the five fixture pages.
Requires pymupdf and Pillow. Never uses paragraph rectangles or divides text equally.
"""
from pathlib import Path
import json
import math
import sys
import fitz
from PIL import Image, ImageDraw

root = Path(__file__).parent
layouts = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
document = fitz.open(root / 'text-layout.pdf')
checks = []
panels = []

def display_point(x, y, rotation):
    if rotation == 90: return 1-y, x
    if rotation == 180: return 1-x, 1-y
    if rotation == 270: return y, 1-x
    return x, y

def utf16_index(text, prefix):
    return len(text[:text.index(prefix)].encode('utf-16-le'))//2

for number, targets in [(1,['iii']), (2,['iii']), (3,['iii']), (5,['fi','e\u0301','😀'])]:
    data = layouts[number-1]['page']
    page = document[number-1]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    overlay = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(overlay)
    selected = []
    for text in targets:
        start = utf16_index(data['text'], text)
        end = start + len(text.encode('utf-16-le'))//2
        assert start in data['boundaries'] and end in data['boundaries']
        units = [u for r in data['runs'] for u in r['units'] if u['start'] >= start and u['end'] <= end]
        assert units and all(u['quad'] is not None for u in units)
        for u in units:
            poly = [display_point(x,y,data['rotation']) for x,y in u['quad']]
            poly = [(x*image.width,y*image.height) for x,y in poly]
            draw.polygon(poly, fill=(255,210,0,90), outline=(0,90,220,255), width=2)
            selected.extend(poly)
        # Independent renderer text advance boundaries; ascent envelopes are intentionally
        # not compared to MuPDF's larger font line boxes or mistaken for painted outlines.
        if number in (1,2):
            expected = page.search_for(text)[0]
            actual_start = units[0]['quad'][0][0]*data['width']
            actual_end = units[-1]['quad'][3][0]*data['width']
            error = max(abs(actual_start-expected.x0),abs(actual_end-expected.x1))
            assert error < 0.02, (number,error)
            checks.append({'page':number,'selected':text,'utf16':[start,end],
                           'advanceEdgeMaxErrorPdfPoints':round(error,6)})
        elif number == 3:
            # Compare projected baseline advance against MuPDF's per-character origins.
            lines = [line for b in page.get_text('rawdict')['blocks'] if b['type']==0 for line in b['lines']]
            chars = [c for line in lines for span in line['spans'] for c in span['chars']]
            index = next(i for i in range(len(chars)-2) if ''.join(c['c'] for c in chars[i:i+3])=='iii')
            origin = chars[index]['origin']
            # font descent normal shift cancels when recovering baseline from the quad
            q = units[0]['quad']; ascent=0.718; descent=-0.207
            actual=( (q[0][0]*ascent-q[1][0]*descent)/(ascent-descent)*data['width'],
                     (q[0][1]*ascent-q[1][1]*descent)/(ascent-descent)*data['height'] )
            error=math.dist(origin,actual)
            assert error<0.02,(number,error)
            checks.append({'page':number,'selected':text,'utf16':[start,end],
                           'baselineOriginErrorPdfPoints':round(error,6)})
        else:
            checks.append({'page':number,'selected':text,'utf16':[start,end],
                           'legalUnits':len(units),'visualReviewRequired':True})
    result = Image.alpha_composite(image.convert('RGBA'),overlay).convert('RGB')
    result.save(output / f'page-{number}-selection.png')
    # Crop representative selected regions with enough context to inspect ink and bounds.
    xs=[p[0] for p in selected]; ys=[p[1] for p in selected]
    crop=result.crop((max(0,min(xs)-150),max(0,min(ys)-65),min(result.width,max(xs)+150),min(result.height,max(ys)+65)))
    label=Image.new('RGB',(max(500,crop.width),crop.height+35),'white')
    label.paste(crop,(0,35))
    ImageDraw.Draw(label).text((8,8),f'Page {number}: crop={data["cropBox"]}; rotation={data["rotation"]}',fill='black')
    panels.append(label)
sheet=Image.new('RGB',(max(p.width for p in panels),sum(p.height for p in panels)+20*(len(panels)-1)), '#eeeeee')
y=0
for panel in panels: sheet.paste(panel,(0,y));y+=panel.height+20
sheet.save(output / 'selection-contact-sheet.png')
(output / 'selection-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
