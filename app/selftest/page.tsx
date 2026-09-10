'use client';

// Internal diagnostic page — not linked from the site nav. Runs real
// assertions against the real engine (`@/lib/pdf`, which is the worker
// client, not a mock) entirely in the browser, because canvas/OffscreenCanvas
// don't exist in Node — a Node-side selftest couldn't touch compress,
// imagesToPdf, or renderThumbnails at all. Fixtures are generated in memory
// with pdf-lib; nothing here reads a file from disk or the network.

import { useEffect, useState } from 'react';
import { degrees, PDFDocument } from 'pdf-lib';
import { compress, imagesToPdf, merge, organize, PdfError, type CompressTier, type PageRef } from '@/lib/pdf';

type TestResult = { name: string; status: 'pass' | 'fail'; detail?: string };

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

async function pdfFile(doc: PDFDocument, filename: string): Promise<File> {
  // `doc.save()` types as Uint8Array<ArrayBufferLike> (TS 5.7+); copy through
  // the `ArrayLike<number>` constructor overload to get a real
  // Uint8Array<ArrayBuffer> that satisfies BlobPart — same fix as worker.ts.
  const bytes = new Uint8Array(await doc.save());
  return new File([bytes], filename, { type: 'application/pdf' });
}

/** Each page gets a distinct width so page identity/order survives round-trips without embedding text or fonts. */
async function makeFixturePdf(widths: number[], filename: string): Promise<File> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 50]);
  return pdfFile(doc, filename);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))), type);
  });
}

async function makePngFile(width: number, height: number, filename: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.fillStyle = '#2255ee';
  ctx.fillRect(0, 0, width, height);
  const blob = await canvasToBlob(canvas, 'image/png');
  return new File([blob], filename, { type: 'image/png' });
}

/**
 * A PDF whose one page embeds a much-higher-resolution PNG than its own point
 * size calls for — the same "raster well above display size" shape as a raw
 * phone-camera scan, and a reliable way to guarantee compress has real
 * redundant resolution to throw away regardless of which tier is used.
 */
async function makeRasterHeavyPdf(): Promise<File> {
  const pageWidthPt = 200;
  const pageHeightPt = 150;
  const imgW = 800;
  const imgH = 600;

  const canvas = document.createElement('canvas');
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  const imageData = ctx.createImageData(imgW, imgH);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (Math.random() * 256) | 0;
    data[i + 1] = (Math.random() * 256) | 0;
    data[i + 2] = (Math.random() * 256) | 0;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const pngBlob = await canvasToBlob(canvas, 'image/png');
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(pngBytes);
  const page = doc.addPage([pageWidthPt, pageHeightPt]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
  return pdfFile(doc, 'raster-heavy.pdf');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testMerge(): Promise<void> {
  const fileA = await makeFixturePdf([100, 150], 'a.pdf');
  const fileB = await makeFixturePdf([200, 250, 300], 'b.pdf');
  const result = await merge([fileA, fileB]);
  const outDoc = await PDFDocument.load(result.bytes);
  assertEqual(outDoc.getPageCount(), 5, 'page count');
  const expectedWidths = [100, 150, 200, 250, 300];
  outDoc.getPages().forEach((page, i) => {
    assertEqual(page.getWidth(), expectedWidths[i], `page ${i} width (content order)`);
  });
}

async function testOrganize(): Promise<void> {
  const doc = await PDFDocument.create();
  const widths = [100, 200, 300, 400];
  const pages = widths.map((w) => doc.addPage([w, 50]));
  // Source page 0 already carries a non-zero /Rotate. Organize's rotation
  // must be the ABSOLUTE final rotation, not a delta on top of whatever the
  // source page already had — this is the case that would silently pass if
  // it were implemented as a relative rotate.
  pages[0].setRotation(degrees(90));
  const file = await pdfFile(doc, 'organize-fixture.pdf');

  // Reordered (2, 0, 3), subsetted (index 1 dropped), rotated.
  const pageRefs: PageRef[] = [
    { pageIndex: 2, rotation: 180 },
    { pageIndex: 0, rotation: 270 },
    { pageIndex: 3, rotation: 0 },
  ];
  const result = await organize(file, pageRefs);
  const outDoc = await PDFDocument.load(result.bytes);
  assertEqual(outDoc.getPageCount(), 3, 'page count (subsetted)');

  const outPages = outDoc.getPages();
  assertEqual(outPages[0].getWidth(), 300, 'page 0 is source index 2 (order)');
  assertEqual(outPages[1].getWidth(), 100, 'page 1 is source index 0 (order)');
  assertEqual(outPages[2].getWidth(), 400, 'page 2 is source index 3 (order)');

  assertEqual(outPages[0].getRotation().angle, 180, 'page 0 rotation');
  assertEqual(
    outPages[1].getRotation().angle,
    270,
    'page 1 rotation is the absolute 270 requested, not 90 (source) + 270',
  );
  assertEqual(outPages[2].getRotation().angle, 0, 'page 2 rotation');
}

async function testImagesToPdf(): Promise<void> {
  const width = 64;
  const height = 48;
  const file = await makePngFile(width, height, 'fixture.png');
  const result = await imagesToPdf([file], { pageSize: 'fit', margin: 0 });
  const outDoc = await PDFDocument.load(result.bytes);
  assertEqual(outDoc.getPageCount(), 1, 'page count');
  const page = outDoc.getPages()[0];
  assertEqual(Math.round(page.getWidth()), width, 'page width matches image width');
  assertEqual(Math.round(page.getHeight()), height, 'page height matches image height');
}

async function testCompressTier(tier: CompressTier): Promise<void> {
  const file = await makeRasterHeavyPdf();
  const originalSize = file.size;
  const result = await compress(file, tier);
  assertTrue(
    result.bytes.byteLength < originalSize,
    `expected compressed size < original for tier "${tier}" (${result.bytes.byteLength}B vs ${originalSize}B)`,
  );
}

// The tiers are hand-tuned numbers, so the thing worth guarding isn't any one
// value — it's that they stay ordered. A tier edit that makes "strong" bigger
// than "light" means the picker is lying to the user about what they chose.
async function testTierOrdering(): Promise<void> {
  const file = await makeRasterHeavyPdf();
  const [light, recommended, strong] = await Promise.all([
    compress(file, 'low'),
    compress(file, 'recommended'),
    compress(file, 'strong'),
  ]);
  assertTrue(
    strong.bytes.byteLength < recommended.bytes.byteLength &&
      recommended.bytes.byteLength < light.bytes.byteLength,
    `expected strong < recommended < light, got ${strong.bytes.byteLength} / ${recommended.bytes.byteLength} / ${light.bytes.byteLength}`,
  );
}

async function testCorruptRejects(): Promise<void> {
  const valid = await makeFixturePdf([100, 100], 'valid.pdf');
  const bytes = new Uint8Array(await valid.arrayBuffer());
  // Stomp the "%PDF-1.x" header magic so no parser can recognize this as a PDF.
  bytes.set([0, 0, 0, 0, 0, 0, 0, 0], 0);
  const corrupt = new File([bytes], 'corrupt.pdf', { type: 'application/pdf' });

  let caught: unknown;
  try {
    await merge([corrupt]);
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof PdfError)) {
    throw new Error(`expected a PdfError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`);
  }
  assertEqual(caught.code, 'corrupt', 'error code');
}

const TESTS: Array<{ name: string; run: () => Promise<void> }> = [
  { name: 'merge: 2-page + 3-page → 5 pages, in order', run: testMerge },
  { name: 'organize: reorder + subset + rotate (absolute rotation)', run: testOrganize },
  { name: 'imagesToPdf: 1 image → 1 page, correct dimensions', run: testImagesToPdf },
  { name: 'compress: low tier → smaller than original', run: () => testCompressTier('low') },
  { name: 'compress: recommended tier → smaller than original', run: () => testCompressTier('recommended') },
  { name: 'compress: strong tier → smaller than original', run: () => testCompressTier('strong') },
  { name: 'compress: strong < recommended < light', run: testTierOrdering },
  { name: 'corrupt bytes: rejects with PdfError code "corrupt"', run: testCorruptRejects },
];

export default function SelftestPage() {
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [running, setRunning] = useState(false);

  async function runAll() {
    setRunning(true);
    setResults(null);
    const out: TestResult[] = [];
    for (const test of TESTS) {
      try {
        await test.run();
        out.push({ name: test.name, status: 'pass' });
      } catch (err) {
        out.push({ name: test.name, status: 'fail', detail: err instanceof Error ? err.message : String(err) });
      }
      // Push incrementally so a hang in a later test doesn't hide earlier results.
      setResults([...out]);
    }
    setRunning(false);
  }

  useEffect(() => {
    void runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passCount = results?.filter((r) => r.status === 'pass').length ?? 0;
  const allDone = results !== null && results.length === TESTS.length;
  const allPass = allDone && passCount === TESTS.length;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.25rem', fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: '1.1rem', fontWeight: 700 }}>lib/pdf selftest</h1>
      <p style={{ color: '#666', fontSize: '0.85rem' }}>
        Runs the real engine (@/lib/pdf, backed by the Web Worker) against in-memory pdf-lib fixtures.
      </p>

      {allDone && (
        <p style={{ fontWeight: 700, color: allPass ? '#0a7d2c' : '#b3261e' }}>
          {allPass ? `ALL PASS (${passCount}/${TESTS.length})` : `${passCount}/${TESTS.length} passed`}
        </p>
      )}
      {running && !allDone && <p>Running…</p>}

      <ul style={{ listStyle: 'none', padding: 0, fontSize: '0.85rem', lineHeight: 1.6 }}>
        {TESTS.map((test, i) => {
          const result = results?.[i];
          const status = result?.status;
          const marker = status === 'pass' ? '[PASS]' : status === 'fail' ? '[FAIL]' : '[ .. ]';
          const color = status === 'pass' ? '#0a7d2c' : status === 'fail' ? '#b3261e' : '#999';
          return (
            <li key={test.name} style={{ color }}>
              {marker} {test.name}
              {result?.status === 'fail' && (
                <div style={{ marginLeft: '2ch', color: '#b3261e' }}>{result.detail}</div>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => void runAll()}
        disabled={running}
        style={{ marginTop: '1.5rem', padding: '0.4rem 0.8rem', fontFamily: 'monospace', cursor: 'pointer' }}
      >
        {running ? 'Running…' : 'Re-run'}
      </button>
    </main>
  );
}
