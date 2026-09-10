// The PDF engine. Everything expensive (parsing, rasterizing, re-encoding)
// happens in here, off the main/UI thread. `index.ts` is the thin main-thread
// client that talks to this file over raw `postMessage` — no Comlink, no
// dependency beyond pdf-lib / pdfjs-dist.
//
// This file IS a dedicated Worker's entry point (instantiated by index.ts via
// `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`).
//
// A landmine worth documenting: pdfjs-dist's worker bundle
// (`pdf.worker.min.mjs`) auto-detects "am I running inside a worker global
// scope with no `window`?" at module-evaluation time and, if so, immediately
// wires itself up to listen on `self` and posts a "ready" message — see the
// `WorkerMessageHandler` static initializer in that file. If we statically
// `import` that module directly into *this* worker, it would hijack our own
// `self` message channel (the one index.ts uses to talk to us) the moment
// pdf.js decided it needed to load its core. That's why we do NOT import the
// worker bundle directly, and instead point `GlobalWorkerOptions.workerSrc`
// at it so pdf.js loads it into a worker of its *own* (either a real nested
// Worker, or — if the browser can't/won't create one — pdf.js's "fake
// worker" fallback, which loads the same module via a dynamic `import()`
// call it makes on its own and only after we take the nested-Worker branch
// out of the running; see PDFWorker#initialize in pdf.mjs). Either way pdf.js
// never touches the main/UI thread and never touches our own `self`.
import {
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import {
  degrees,
  EncryptedPDFError,
  PageSizes,
  PDFDocument as PdfLibDocument,
  type PDFImage,
} from 'pdf-lib';
import {
  PdfError,
  type CompressTier,
  type ImagesToPdfOptions,
  type PageRef,
  type PdfErrorCode,
  type PdfResult,
  type Progress,
} from './types';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// ---------------------------------------------------------------------------
// Wire protocol between index.ts (main thread) and this file.
// ---------------------------------------------------------------------------

export type WorkerRequest =
  | { id: number; kind: 'merge'; files: File[] }
  | { id: number; kind: 'organize'; file: File; pages: PageRef[] }
  | { id: number; kind: 'compress'; file: File; tier: CompressTier }
  | { id: number; kind: 'imagesToPdf'; images: File[]; opts: ImagesToPdfOptions }
  | { id: number; kind: 'pageCount'; file: File }
  | { id: number; kind: 'renderThumbnails'; file: File }
  | { id: number; kind: 'hasTextLayer'; file: File };

export type WorkerResultValue =
  | { op: 'pdf'; result: PdfResult }
  | { op: 'count'; count: number }
  | { op: 'thumbnails'; blobs: Blob[] }
  | { op: 'text-layer'; hasText: boolean };

export type WorkerResponse =
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'result'; value: WorkerResultValue }
  | { id: number; kind: 'error'; code: PdfErrorCode; message: string; filename?: string };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** ~8000x8000. Guards against trying to allocate a canvas for a pathological page. */
const MAX_RASTER_PIXELS = 64_000_000;

async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function assertNotEmpty(bytes: Uint8Array, filename: string): void {
  if (bytes.byteLength === 0) {
    throw new PdfError('empty', `"${filename}" is empty.`, filename);
  }
}

function assertRasterSizeOk(width: number, height: number, filename: string): void {
  if (width * height > MAX_RASTER_PIXELS) {
    throw new PdfError('too-large', `"${filename}" has a page too large to rasterize.`, filename);
  }
}

function withSuffix(filename: string, suffix: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}-${suffix}.pdf`;
}

function classifyPdfLibError(err: unknown, filename: string): PdfError {
  if (err instanceof PdfError) return err;
  if (err instanceof EncryptedPDFError) {
    return new PdfError('encrypted', `"${filename}" is password-protected.`, filename);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new PdfError('corrupt', message || `"${filename}" could not be read.`, filename);
}

function classifyPdfJsError(err: unknown, filename: string): PdfError {
  if (err instanceof PdfError) return err;
  if (err instanceof PasswordException) {
    return new PdfError('encrypted', `"${filename}" is password-protected.`, filename);
  }
  if (err instanceof InvalidPDFException) {
    return new PdfError('corrupt', `"${filename}" is not a valid PDF.`, filename);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/alloc|memory/i.test(message)) {
    return new PdfError('too-large', `"${filename}" is too large to process.`, filename);
  }
  return new PdfError('corrupt', message || `"${filename}" could not be read.`, filename);
}

async function loadPdfLibDoc(bytes: Uint8Array, filename: string): Promise<PdfLibDocument> {
  assertNotEmpty(bytes, filename);
  let doc: PdfLibDocument;
  try {
    doc = await PdfLibDocument.load(bytes);
  } catch (err) {
    throw classifyPdfLibError(err, filename);
  }
  if (doc.getPageCount() === 0) {
    throw new PdfError('empty', `"${filename}" has no pages.`, filename);
  }
  return doc;
}

async function loadPdfJsDoc(bytes: Uint8Array, filename: string): Promise<PDFDocumentProxy> {
  assertNotEmpty(bytes, filename);
  // Deliberately not setting `loadingTask.onPassword`: pdf.js only prompts
  // for a password (hanging indefinitely waiting on the callback) when a
  // caller has registered one. With none registered it rejects immediately
  // with a PasswordException instead — see WorkerTransport's "PasswordRequest"
  // handler in pdf.mjs. That immediate rejection is exactly what we want for
  // the 'encrypted' error code: no password UI in v1, no hang either.
  const loadingTask = getDocument({ data: bytes });
  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    throw classifyPdfJsError(err, filename);
  }
  if (doc.numPages === 0) {
    await doc.destroy();
    throw new PdfError('empty', `"${filename}" has no pages.`, filename);
  }
  return doc;
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

async function merge(files: File[], report: Progress): Promise<PdfResult> {
  if (files.length === 0) {
    throw new PdfError('empty', 'No files to merge.');
  }
  const outDoc = await PdfLibDocument.create();
  const total = files.length;
  report(0, total);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bytes = await readBytes(file);
    const srcDoc = await loadPdfLibDoc(bytes, file.name);
    const copied = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const page of copied) outDoc.addPage(page);
    report(i + 1, total);
  }
  const bytes = await outDoc.save();
  return { bytes, filename: 'merged.pdf' };
}

// ---------------------------------------------------------------------------
// organize
// ---------------------------------------------------------------------------

async function organize(file: File, pages: PageRef[], report: Progress): Promise<PdfResult> {
  if (pages.length === 0) {
    throw new PdfError('empty', 'No pages selected.', file.name);
  }
  const bytes = await readBytes(file);
  const srcDoc = await loadPdfLibDoc(bytes, file.name);
  const maxIndex = srcDoc.getPageCount() - 1;
  for (const p of pages) {
    if (!Number.isInteger(p.pageIndex) || p.pageIndex < 0 || p.pageIndex > maxIndex) {
      throw new PdfError('corrupt', `Page index ${p.pageIndex} is out of range for "${file.name}".`, file.name);
    }
  }

  const outDoc = await PdfLibDocument.create();
  const total = pages.length;
  report(0, total);
  const copied = await outDoc.copyPages(
    srcDoc,
    pages.map((p) => p.pageIndex),
  );
  copied.forEach((page, i) => {
    // Rotation is ABSOLUTE (the page's final rotation), never a delta. A page
    // copied via copyPages carries whatever /Rotate the source page already
    // had, so we must call setRotation unconditionally — including
    // degrees(0) — to override it rather than only rotating on a non-zero
    // value.
    page.setRotation(degrees(pages[i].rotation));
    outDoc.addPage(page);
    report(i + 1, total);
  });

  const outBytes = await outDoc.save();
  return { bytes: outBytes, filename: withSuffix(file.name, 'organized') };
}

// ---------------------------------------------------------------------------
// compress
// ---------------------------------------------------------------------------

// Starting point from PLAN.md §3, validated so far only against the
// synthetic raster-heavy fixture in app/selftest (a large noise image
// embedded well above its display size — see selftest for why that's a
// meaningful stand-in). No real-world PDF corpus was available in this
// environment to tune further; PLAN.md §6 has the reviewer doing that
// against a real "messy" PDF at Gate 1. Treat these three numbers as a
// starting guess, not a final answer.
const COMPRESS_TIERS: Record<CompressTier, { scale: number; quality: number }> = {
  low: { scale: 1.0, quality: 0.75 },
  recommended: { scale: 1.5, quality: 0.6 },
  strong: { scale: 1.0, quality: 0.4 },
};

async function compress(file: File, tier: CompressTier, report: Progress): Promise<PdfResult> {
  const originalBytes = await readBytes(file);
  assertNotEmpty(originalBytes, file.name);
  const { scale, quality } = COMPRESS_TIERS[tier];
  const doc = await loadPdfJsDoc(originalBytes, file.name);
  try {
    const outDoc = await PdfLibDocument.create();
    const total = doc.numPages;
    report(0, total);
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      try {
        // Physical page size in points, rotation already applied by pdf.js
        // (getViewport defaults `rotation` to the page's own /Rotate).
        const sizeViewport = page.getViewport({ scale: 1 });
        const rasterViewport = page.getViewport({ scale });
        const width = Math.max(1, Math.ceil(rasterViewport.width));
        const height = Math.max(1, Math.ceil(rasterViewport.height));
        assertRasterSizeOk(width, height, file.name);

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new PdfError('corrupt', 'Canvas 2D context unavailable.', file.name);
        // pdf.js duck-types on `canvas.getContext(...)`; OffscreenCanvas
        // works at runtime even though the public .d.ts still only spells
        // out HTMLCanvasElement (pdf.js itself uses OffscreenCanvas
        // internally — see `isOffscreenCanvasSupported` in pdf.mjs).
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport: rasterViewport }).promise;

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        const jpegBytes = new Uint8Array(await blob.arrayBuffer());
        const image = await outDoc.embedJpg(jpegBytes);
        const outPage = outDoc.addPage([sizeViewport.width, sizeViewport.height]);
        outPage.drawImage(image, {
          x: 0,
          y: 0,
          width: sizeViewport.width,
          height: sizeViewport.height,
        });
      } finally {
        page.cleanup();
      }
      report(i, total);
    }

    const compressedBytes = await outDoc.save();
    if (compressedBytes.byteLength >= originalBytes.byteLength) {
      // Rasterizing made it worse — common on small, already-efficient,
      // mostly-text PDFs. Never hand back a file bigger than the input.
      console.warn(
        `[pdf/compress] "${file.name}": compressed (${compressedBytes.byteLength}B) >= original (${originalBytes.byteLength}B); returning the original untouched.`,
      );
      return { bytes: originalBytes, filename: file.name };
    }
    return { bytes: compressedBytes, filename: withSuffix(file.name, 'compressed') };
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// imagesToPdf
// ---------------------------------------------------------------------------

type ImageKind = 'jpeg' | 'png' | 'webp';

function mimeFor(kind: ImageKind): string {
  switch (kind) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
  }
}

function sniffImageKind(bytes: Uint8Array, mimeHint: string): ImageKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return 'webp';
  }
  if (mimeHint === 'image/png') return 'png';
  if (mimeHint === 'image/jpeg' || mimeHint === 'image/jpg') return 'jpeg';
  if (mimeHint === 'image/webp') return 'webp';
  return null;
}

async function imagesToPdf(images: File[], opts: ImagesToPdfOptions, report: Progress): Promise<PdfResult> {
  if (images.length === 0) {
    throw new PdfError('empty', 'No images to place.');
  }
  const outDoc = await PdfLibDocument.create();
  const total = images.length;
  report(0, total);

  for (let i = 0; i < images.length; i++) {
    const file = images[i];
    const bytes = await readBytes(file);
    assertNotEmpty(bytes, file.name);
    const kind = sniffImageKind(bytes, file.type);
    if (!kind) {
      throw new PdfError('unsupported', `"${file.name}" is not a JPEG, PNG, or WebP image.`, file.name);
    }

    // Every image — JPEG included — goes through createImageBitmap with
    // `imageOrientation: 'from-image'` and is redrawn onto a canvas before
    // embedding. That bakes any EXIF rotation into the actual pixels: phone
    // photos are the main input to this tool, and pdf-lib's embedJpg has no
    // concept of EXIF orientation — it just reads width/height off the JPEG
    // SOF marker and embeds the stream as-is, so an un-rotated embed would
    // come out sideways in the PDF whenever the source photo relied on EXIF
    // for its displayed orientation.
    // ponytail: this recompresses JPEGs that were already upright too — a
    // small quality cost (embedded at q0.92) paid on every image, not just
    // rotated ones. Upgrade path if that ever matters: parse the EXIF
    // orientation tag ourselves and skip the canvas round-trip when it's 1.
    const sourceBlob = new Blob([bytes], { type: mimeFor(kind) });
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' });
    } catch {
      throw new PdfError('unsupported', `Could not decode "${file.name}".`, file.name);
    }

    let embedded: PDFImage;
    try {
      assertRasterSizeOk(bitmap.width, bitmap.height, file.name);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new PdfError('corrupt', 'Canvas 2D context unavailable.', file.name);
      ctx.drawImage(bitmap, 0, 0);
      const outType = kind === 'png' ? 'image/png' : 'image/jpeg';
      const outBlob = await canvas.convertToBlob(
        outType === 'image/jpeg' ? { type: outType, quality: 0.92 } : { type: outType },
      );
      const outBytes = new Uint8Array(await outBlob.arrayBuffer());
      embedded = outType === 'image/png' ? await outDoc.embedPng(outBytes) : await outDoc.embedJpg(outBytes);
    } finally {
      bitmap.close();
    }

    if (opts.pageSize === 'fit') {
      const w = embedded.width + opts.margin * 2;
      const h = embedded.height + opts.margin * 2;
      const page = outDoc.addPage([w, h]);
      page.drawImage(embedded, { x: opts.margin, y: opts.margin, width: embedded.width, height: embedded.height });
    } else {
      const [pageW, pageH] = PageSizes.A4;
      const maxW = Math.max(1, pageW - opts.margin * 2);
      const maxH = Math.max(1, pageH - opts.margin * 2);
      const fitScale = Math.min(maxW / embedded.width, maxH / embedded.height);
      const w = embedded.width * fitScale;
      const h = embedded.height * fitScale;
      const page = outDoc.addPage([pageW, pageH]);
      page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    }
    report(i + 1, total);
  }

  const bytes = await outDoc.save();
  return { bytes, filename: 'images.pdf' };
}

// ---------------------------------------------------------------------------
// pageCount
// ---------------------------------------------------------------------------

async function pageCount(file: File): Promise<number> {
  const bytes = await readBytes(file);
  const doc = await loadPdfLibDoc(bytes, file.name);
  return doc.getPageCount();
}

// ---------------------------------------------------------------------------
// renderThumbnails
// ---------------------------------------------------------------------------

/** Sensible thumbnail cap so a 300-page document doesn't exhaust memory. */
const THUMBNAIL_WIDTH = 200;

async function renderThumbnails(file: File, report: Progress): Promise<Blob[]> {
  const bytes = await readBytes(file);
  const doc = await loadPdfJsDoc(bytes, file.name);
  try {
    const total = doc.numPages;
    report(0, total);
    const blobs: Blob[] = [];
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = THUMBNAIL_WIDTH / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        assertRasterSizeOk(width, height, file.name);

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new PdfError('corrupt', 'Canvas 2D context unavailable.', file.name);
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        blobs.push(blob);
      } finally {
        page.cleanup();
      }
      report(i, total);
    }
    return blobs;
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// hasTextLayer
// ---------------------------------------------------------------------------

const TEXT_SAMPLE_PAGES = 3;
const MEANINGFUL_TEXT_CHARS = 20;

async function hasTextLayer(file: File): Promise<boolean> {
  const bytes = await readBytes(file);
  const doc = await loadPdfJsDoc(bytes, file.name);
  try {
    const pagesToSample = Math.min(TEXT_SAMPLE_PAGES, doc.numPages);
    let meaningfulChars = 0;
    for (let i = 1; i <= pagesToSample; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        for (const item of content.items) {
          if ('str' in item) meaningfulChars += item.str.trim().length;
        }
      } finally {
        page.cleanup();
      }
      if (meaningfulChars >= MEANINGFUL_TEXT_CHARS) return true;
    }
    return meaningfulChars >= MEANINGFUL_TEXT_CHARS;
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

function isWorkerRequest(data: unknown): data is WorkerRequest {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { id?: unknown }).id === 'number' &&
    typeof (data as { kind?: unknown }).kind === 'string'
  );
}

function toPdfError(err: unknown): PdfError {
  if (err instanceof PdfError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new PdfError('corrupt', message || 'Unknown error.');
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  const data = event.data;
  // Anything not shaped like our own protocol is ignored rather than
  // throwing — guards against stray messages from pdf.js's own worker
  // machinery ever reaching this handler.
  if (!isWorkerRequest(data)) return;
  const { id } = data;
  const report: Progress = (done, total) => {
    self.postMessage({ id, kind: 'progress', done, total } satisfies WorkerResponse);
  };

  try {
    let value: WorkerResultValue;
    switch (data.kind) {
      case 'merge':
        value = { op: 'pdf', result: await merge(data.files, report) };
        break;
      case 'organize':
        value = { op: 'pdf', result: await organize(data.file, data.pages, report) };
        break;
      case 'compress':
        value = { op: 'pdf', result: await compress(data.file, data.tier, report) };
        break;
      case 'imagesToPdf':
        value = { op: 'pdf', result: await imagesToPdf(data.images, data.opts, report) };
        break;
      case 'pageCount':
        value = { op: 'count', count: await pageCount(data.file) };
        break;
      case 'renderThumbnails':
        value = { op: 'thumbnails', blobs: await renderThumbnails(data.file, report) };
        break;
      case 'hasTextLayer':
        value = { op: 'text-layer', hasText: await hasTextLayer(data.file) };
        break;
    }
    const response: WorkerResponse = { id, kind: 'result', value };
    const transfer: Transferable[] = value.op === 'pdf' ? [value.result.bytes.buffer as ArrayBuffer] : [];
    self.postMessage(response, transfer);
  } catch (err) {
    const pdfErr = toPdfError(err);
    self.postMessage({
      id,
      kind: 'error',
      code: pdfErr.code,
      message: pdfErr.message,
      filename: pdfErr.filename,
    } satisfies WorkerResponse);
  }
};
