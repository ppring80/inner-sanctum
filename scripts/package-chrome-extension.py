#!/usr/bin/env python3
"""Build and verify a clean extension ZIP from manifest-local dependencies."""
import argparse, hashlib, json, pathlib, re, zipfile

def closure(read):
    manifest = json.loads(read('manifest.json'))
    required = {'manifest.json'}
    def add(value):
        if isinstance(value, dict):
            for v in value.values(): add(v)
        elif isinstance(value, list):
            for v in value: add(v)
        elif isinstance(value, str) and re.search(r'\.(?:js|css|html|png|jpg|svg|woff2?)$', value):
            if '://' in value or value.startswith('/') or '..' in pathlib.PurePosixPath(value).parts:
                raise ValueError('Nonlocal extension dependency')
            required.add(value)
    add(manifest)
    scanned = set()
    while required - scanned:
        name = sorted(required - scanned)[0]
        data = read(name)
        scanned.add(name)
        if name.endswith(('.js', '.html', '.css')):
            text = data.decode()
            for ref in re.findall(r'''["']([^"'\n]+\.(?:js|css|html|png|jpg|svg|woff2?))["']''', text):
                if '://' in ref: raise ValueError('Remote executable/resource dependency')
                add(str(pathlib.PurePosixPath(name).parent / ref))
    return required

def verify(filename):
    with zipfile.ZipFile(filename) as z:
        names = z.namelist()
        if len(names) != len(set(names)): raise ValueError('Duplicate archive entries')
        required = closure(z.read)
        if set(names) != required: raise ValueError('Archive contains unexpected files')
        return len(required)

def build(root, target):
    source = pathlib.Path(root) / 'cbs-extension'
    required = closure(lambda n: (source/n).read_bytes())
    target = pathlib.Path(target); target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ['manifest.json'] + sorted(required - {'manifest.json'}):
            info = zipfile.ZipInfo(name, (2026,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info, (source/name).read_bytes())
    count=verify(target)
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.sha256').write_text(digest+'  '+target.name+'\n')
    return count

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--verify');p.add_argument('--output');a=p.parse_args()
    count=verify(a.verify) if a.verify else build(pathlib.Path(__file__).resolve().parent.parent,a.output)
    print('PASS: packaged manifest dependency closure (%d files)' % count)
