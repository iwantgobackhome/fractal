"""Read only E's retained QA SQLite rows and PDF bytes; no D data or credentials."""
import hashlib
import json
import pathlib
import sqlite3

owned = pathlib.Path('docs/implementation/qa/native-bridge')
identity = json.loads((owned / 'runtime/server-identity.json').read_text())
store = pathlib.Path(identity['directory'])
database = sqlite3.connect((store / 'library.sqlite').as_uri() + '?mode=ro', uri=True)
key = 'qa-reader-catalog'
def rows(query, arguments):
    return [json.loads(row[0]) for row in database.execute(query, arguments)]
record = rows('SELECT data FROM bibliography WHERE paper_key=?', [key])[0]
paper = rows('SELECT data FROM papers WHERE paper_key=?', [key])[0]
folders = rows('SELECT data FROM collections WHERE id IN (?,?)', ['qa-bridge-parent', 'qa-bridge-child'])
annotations = rows('SELECT data FROM annotations WHERE paper_key=?', [key])
wire = json.loads((owned / 'evidence/wire.json').read_text())
memo_id = [a['id'] for request in wire for a in request['body'].get('annotations', []) if a['paperKey'] == key][-1]
memo = next(a for a in annotations if a['id'] == memo_id)
assert not memo['deleted'] and memo['text'] == 'Bridge retained annotation'
assert any(f['id'] == 'qa-bridge-parent' and f['deleted'] for f in folders)
assert any(f['id'] == 'qa-bridge-child' and not f['deleted'] and f['parentId'] is None for f in folders)
assert record['collections'] == ['qa-bridge-child']
pdf = store / 'pdfs' / (paper['pdfSha256'] + '.pdf')
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == paper['pdfSha256']
(owned / 'evidence/server-storage-after.json').write_text(json.dumps({
    'readOnly': True, 'paper': paper, 'library': record, 'folders': folders,
    'finalNativeMemo': memo, 'pdfPresent': pdf.is_file(), 'pdfSha256Matches': True,
}, indent=2) + '\n')
database.close()
print('Read-only E server storage confirms promoted child, converged membership, native memo and PDF retention')
