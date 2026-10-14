import sys, zipfile, re
from xml.etree import ElementTree as ET
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NSR = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def colnum(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    if not m: return 0
    n = 0
    for ch in m.group(1): n = n * 26 + (ord(ch) - 64)
    return n - 1

def read(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in
            ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheets = []
    for sh in wb.iter(NS + 'sheet'):
        tgt = rels.get(sh.get(NSR + 'id'), '')
        if not tgt.startswith('xl/'): tgt = 'xl/' + tgt.lstrip('/')
        sheets.append((sh.get('name'), tgt))
    out = []
    for name, tgt in sheets:
        rows = []
        for row in ET.fromstring(z.read(tgt)).iter(NS + 'row'):
            cells = {}
            for c in row.iter(NS + 'c'):
                v = c.find(NS + 'v'); isel = c.find(NS + 'is')
                if c.get('t') == 's' and v is not None:
                    val = shared[int(v.text)]
                elif isel is not None:
                    val = ''.join(t.text or '' for t in isel.iter(NS + 't'))
                elif v is not None:
                    val = v.text
                else:
                    val = ''
                cells[colnum(c.get('r'))] = (val or '').strip()
            if cells:
                rows.append([cells.get(i, '') for i in range(max(cells) + 1)])
        out.append((name, rows))
    return out
