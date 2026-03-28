#!/usr/bin/env python3
"""Generate test fixture archives for Comiscopio worker tests.

Output structure:
  archive/
    test-5pages.cbz     — 5 pages, ZIP
    test-5pages.cbr     — 5 pages, RAR  (requires `rar` on PATH)
    test-5pages.cb7     — 5 pages, 7z
    test-5pages.cbt     — 5 pages, TAR
    test-single.cbz     — 1 page,  ZIP  (edge case)
    test-empty.cbz      — ZIP with no image files (error case)
    test-not-images.tar — TAR of CBR files, not direct images (error case)
  doc/
    test-5pages.pdf     — 5-page PDF  (requires fpdf2)
    test-5pages.epub    — 5-page EPUB

All pages are 200×300 px solid-colour PNGs.
"""

import io
import os
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
    (220, 60,  60),   # red
    (60,  180, 60),   # green
    (60,  100, 220),  # blue
    (220, 180, 60),   # yellow
    (180, 60,  220),  # purple
]
PAGE_W, PAGE_H = 200, 300


# ---------------------------------------------------------------------------
# Minimal PNG encoder (stdlib only, no Pillow)
# ---------------------------------------------------------------------------

def make_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    """Create a minimal valid RGB PNG filled with a solid colour."""
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


def page_pngs(count: int = 5) -> list[tuple[str, bytes]]:
    return [(f'{i+1:04d}.png', make_png(PAGE_W, PAGE_H, *COLORS[i % len(COLORS)]))
            for i in range(count)]


# ---------------------------------------------------------------------------
# Archive builders
# ---------------------------------------------------------------------------

def build_cbz(dest: str, pages: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, data in pages:
            zf.writestr(name, data)
    print(f'  {dest}')


def build_cbt(dest: str, pages: list[tuple[str, bytes]]) -> None:
    with tarfile.open(dest, 'w') as tf:
        for name, data in pages:
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    print(f'  {dest}')


def build_cb7(dest: str, pages: list[tuple[str, bytes]], tmpdir: str) -> None:
    src_dir = os.path.join(tmpdir, 'cb7_pages')
    os.makedirs(src_dir, exist_ok=True)
    for name, data in pages:
        with open(os.path.join(src_dir, name), 'wb') as f:
            f.write(data)
    result = subprocess.run(
        ['7z', 'a', '-t7z', '-mx=1', dest] + [os.path.join(src_dir, n) for n, _ in pages],
        capture_output=True,
    )
    if result.returncode != 0:
        print(f'  WARNING: 7z failed — {result.stderr.decode()[:120]}', file=sys.stderr)
    else:
        print(f'  {dest}')


def build_cbr(dest: str, pages: list[tuple[str, bytes]], tmpdir: str) -> None:
    src_dir = os.path.join(tmpdir, 'cbr_pages')
    os.makedirs(src_dir, exist_ok=True)
    for name, data in pages:
        with open(os.path.join(src_dir, name), 'wb') as f:
            f.write(data)
    result = subprocess.run(
        ['rar', 'a', '-m1', '-ep', dest] + [os.path.join(src_dir, n) for n, _ in pages],
        capture_output=True,
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
        f'    <item id="page{i+1}" href="page{i+1}.xhtml"'
        f' media-type="application/xhtml+xml"/>'
        for i in range(5)
    )
    spine_items = '\n'.join(
        f'    <itemref idref="page{i+1}"/>' for i in range(5)
    )
    content_opf = f"""\
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Comic</dc:title>
    <dc:identifier id="uid">test-comic-001</dc:identifier>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx"
          media-type="application/x-dtbncx+xml"/>
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
        zf.writestr(zipfile.ZipInfo('mimetype'), b'application/epub+zip',
                    compress_type=zipfile.ZIP_STORED)
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
        print(f'  WARNING: {cbr_path} not found — skipping test-not-images.tar',
              file=sys.stderr)
        return
    with tarfile.open(dest, 'w') as tf:
        tf.add(cbr_path, arcname=os.path.basename(cbr_path))
    print(f'  {dest}')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    os.makedirs(DOC_DIR, exist_ok=True)

    print('archive/')
    pages5 = page_pngs(5)
    pages1 = page_pngs(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        build_cbz(os.path.join(ARCHIVE_DIR, 'test-5pages.cbz'), pages5)
        build_cbz(os.path.join(ARCHIVE_DIR, 'test-single.cbz'), pages1)
        build_cbt(os.path.join(ARCHIVE_DIR, 'test-5pages.cbt'), pages5)
        build_cb7(os.path.join(ARCHIVE_DIR, 'test-5pages.cb7'), pages5, tmpdir)
        build_cbr(os.path.join(ARCHIVE_DIR, 'test-5pages.cbr'), pages5, tmpdir)
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
