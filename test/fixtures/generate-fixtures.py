#!/usr/bin/env python3
"""Generate synthetic fixtures for Comiscopio worker tests.

Archive fixtures cover:
- flat archives
- single-page archive
- empty archive / non-image archive
- common root folder
- Unicode folder and file names
- sidecars and junk files
- multiple folders with natural ordering and extras included
"""

import io
import os
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile
import zlib

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, 'archive')
DOC_DIR = os.path.join(SCRIPT_DIR, 'doc')

COLORS = [
    (220, 60, 60),
    (60, 180, 60),
    (60, 100, 220),
    (220, 180, 60),
    (180, 60, 220),
]
PAGE_W, PAGE_H = 200, 300


def make_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        length = struct.pack('>I', len(data))
        payload = tag + data
        crc = struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)
        return length + payload + crc

    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    scanline = bytes([0]) + bytes([r, g, b] * width)
    raw = scanline * height
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend


def page_entries(names: list[str]) -> list[tuple[str, bytes]]:
    entries: list[tuple[str, bytes]] = []
    for index, name in enumerate(names):
        entries.append((name, make_png(PAGE_W, PAGE_H, *COLORS[index % len(COLORS)])))
    return entries


def flat_entries(count: int = 5) -> list[tuple[str, bytes]]:
    return page_entries([f'{i + 1:04d}.png' for i in range(count)])


def root_folder_entries() -> list[tuple[str, bytes]]:
    return page_entries([f'comic/{i + 1:04d}.png' for i in range(5)])


def unicode_folder_entries() -> list[tuple[str, bytes]]:
    return page_entries([f'Capítulo Único/Página_{i + 1:02d}.png' for i in range(5)])


def comicinfo_junk_entries() -> list[tuple[str, bytes]]:
    entries = page_entries([f'Comic Deluxe/{i + 1:04d}.png' for i in range(5)])
    entries.extend([
        ('Comic Deluxe/ComicInfo.xml', b'<ComicInfo><Title>Fixture</Title></ComicInfo>\n'),
        ('Comic Deluxe/.DS_Store', b'junk\n'),
        ('Comic Deluxe/Thumbs.db', b'junk\n'),
        ('Comic Deluxe/desktop.ini', b'junk\n'),
        ('__MACOSX/Comic Deluxe/._0001.png', b'junk\n'),
    ])
    return entries


def multifolder_entries() -> list[tuple[str, bytes]]:
    return page_entries([
        'extras/0001.png',
        'cap_10/0001.png',
        'cap_02/0001.png',
        'cap_01/0002.png',
        'cap_01/0001.png',
    ])


def write_tree(base_dir: str, entries: list[tuple[str, bytes]]) -> None:
    for rel_path, data in entries:
        full_path = os.path.join(base_dir, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'wb') as f:
            f.write(data)


def relative_files(base_dir: str) -> list[str]:
    paths: list[str] = []
    for root, _, files in os.walk(base_dir):
        for name in files:
            rel = os.path.relpath(os.path.join(root, name), base_dir)
            paths.append(rel)
    return sorted(paths)


def build_cbz(dest: str, entries: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    print(f'  {dest}')


def build_cbt(dest: str, entries: list[tuple[str, bytes]]) -> None:
    with tarfile.open(dest, 'w') as tf:
        for name, data in entries:
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    print(f'  {dest}')


def build_cb7(dest: str, entries: list[tuple[str, bytes]], tmpdir: str, name: str) -> None:
    src_dir = os.path.join(tmpdir, f'cb7_{name}')
    os.makedirs(src_dir, exist_ok=True)
    write_tree(src_dir, entries)
    result = subprocess.run(
        ['7z', 'a', '-t7z', '-mx=1', dest] + relative_files(src_dir),
        capture_output=True,
        cwd=src_dir,
    )
    if result.returncode != 0:
        print(f'  WARNING: 7z failed for {dest} — {result.stderr.decode()[:160]}', file=sys.stderr)
    else:
        print(f'  {dest}')


def build_cbr(dest: str, entries: list[tuple[str, bytes]], tmpdir: str, name: str) -> None:
    src_dir = os.path.join(tmpdir, f'cbr_{name}')
    os.makedirs(src_dir, exist_ok=True)
    write_tree(src_dir, entries)
    result = subprocess.run(
        ['rar', 'a', '-m1', dest] + relative_files(src_dir),
        capture_output=True,
        cwd=src_dir,
    )
    if result.returncode != 0:
        print(f'  WARNING: rar failed — install `rar` to generate CBR fixtures', file=sys.stderr)
    else:
        print(f'  {dest}')


def build_pdf(dest: str) -> None:
    try:
        from fpdf import FPDF
    except ImportError:
        print('  WARNING: fpdf2 not installed — skipping PDF fixture', file=sys.stderr)
        return
    pdf = FPDF(orientation='P', unit='mm', format=(105, 148))
    for i, (r, g, b) in enumerate(COLORS):
        pdf.add_page()
        pdf.set_fill_color(r, g, b)
        pdf.rect(0, 0, 105, 148, 'F')
        pdf.set_font('Helvetica', size=24)
        pdf.set_text_color(255, 255, 255)
        pdf.set_xy(0, 60)
        pdf.cell(105, 20, text=f'Page {i + 1}', align='C')
    pdf.output(dest)
    print(f'  {dest}')


def build_epub(dest: str) -> None:
    container_xml = b"""\
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:schemas:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf"
              media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""
    opf_items = '\n'.join(
        f'    <item id="page{i+1}" href="page{i+1}.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(5)
    )
    spine_items = '\n'.join(f'    <itemref idref="page{i+1}"/>' for i in range(5))
    content_opf = f"""\
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Comic</dc:title>
    <dc:identifier id="uid">test-comic-001</dc:identifier>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
{opf_items}
  </manifest>
  <spine toc="ncx">
{spine_items}
  </spine>
</package>
""".encode()
    toc_ncx = b"""\
<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="test-comic-001"/></head>
  <docTitle><text>Test Comic</text></docTitle>
  <navMap/>
</ncx>
"""

    def xhtml_page(idx: int, r: int, g: int, b: int) -> bytes:
        return f"""\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"
  "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Page {idx}</title>
  <style>body{{margin:0;background:rgb({r},{g},{b});display:flex;
  align-items:center;justify-content:center;height:100vh}}
  h1{{color:white;font-size:3em}}</style></head>
  <body><h1>Page {idx}</h1></body>
</html>
""".encode()

    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(zipfile.ZipInfo('mimetype'), b'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        zf.writestr('META-INF/container.xml', container_xml)
        zf.writestr('OEBPS/content.opf', content_opf)
        zf.writestr('OEBPS/toc.ncx', toc_ncx)
        for i, (r, g, b) in enumerate(COLORS):
            zf.writestr(f'OEBPS/page{i+1}.xhtml', xhtml_page(i + 1, r, g, b))
    print(f'  {dest}')


def build_empty_cbz(dest: str) -> None:
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('README.txt', b'This archive contains no images.\n')
    print(f'  {dest}')


def build_not_images_tar(dest: str, cbr_path: str) -> None:
    if not os.path.exists(cbr_path):
        print(f'  WARNING: {cbr_path} not found — skipping test-not-images.tar', file=sys.stderr)
        return
    with tarfile.open(dest, 'w') as tf:
        tf.add(cbr_path, arcname=os.path.basename(cbr_path))
    print(f'  {dest}')


def build_archive_family(name: str, entries: list[tuple[str, bytes]], tmpdir: str) -> None:
    build_cbz(os.path.join(ARCHIVE_DIR, f'{name}.cbz'), entries)
    build_cbt(os.path.join(ARCHIVE_DIR, f'{name}.cbt'), entries)
    build_cb7(os.path.join(ARCHIVE_DIR, f'{name}.cb7'), entries, tmpdir, name)
    build_cbr(os.path.join(ARCHIVE_DIR, f'{name}.cbr'), entries, tmpdir, name)


def reset_output_dirs() -> None:
    shutil.rmtree(ARCHIVE_DIR, ignore_errors=True)
    shutil.rmtree(DOC_DIR, ignore_errors=True)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    os.makedirs(DOC_DIR, exist_ok=True)


def main() -> None:
    reset_output_dirs()

    print('archive/')
    with tempfile.TemporaryDirectory() as tmpdir:
        build_archive_family('test-5pages', flat_entries(5), tmpdir)
        build_archive_family('test-root-folder', root_folder_entries(), tmpdir)
        build_archive_family('test-unicode-folder', unicode_folder_entries(), tmpdir)
        build_archive_family('test-comicinfo-junk', comicinfo_junk_entries(), tmpdir)
        build_archive_family('test-multifolder', multifolder_entries(), tmpdir)

        build_cbz(os.path.join(ARCHIVE_DIR, 'test-single.cbz'), flat_entries(1))
        build_empty_cbz(os.path.join(ARCHIVE_DIR, 'test-empty.cbz'))
        build_not_images_tar(
            os.path.join(ARCHIVE_DIR, 'test-not-images.tar'),
            os.path.join(ARCHIVE_DIR, 'test-5pages.cbr'),
        )

    print('doc/')
    build_pdf(os.path.join(DOC_DIR, 'test-5pages.pdf'))
    build_epub(os.path.join(DOC_DIR, 'test-5pages.epub'))
    print('Done.')


if __name__ == '__main__':
    main()
