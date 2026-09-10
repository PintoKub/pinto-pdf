// Main-thread client for the PDF engine. Every exported function posts a
// request to `worker.ts` and resolves/rejects a promise keyed by a request
// id — a raw `postMessage` RPC, no Comlink, no dependency beyond pdf-lib /
// pdfjs-dist (both live in the worker, not here).
//
// Three things this file exists to get right:
//   1. Route each worker response back to the call that made it, including
//      `onProgress` ticks, via a request-id map.
//   2. Rehydrate errors. A structured-clone of an `Error` across the worker
//      boundary loses the subclass — it comes back as a plain object, not a
//      `PdfError`. The worker sends `{code, message, filename}` instead
//      (see worker.ts's `catch` in `self.onmessage`) and we reconstruct the
//      real class here, because Agent B's UI switches on
//      `err instanceof PdfError` and on `err.code`.
//   3. Never touch `Worker` at module load. Next.js evaluates client-module
//      code during the server/prerender pass too, where `Worker` doesn't
//      exist — the worker is created lazily, on the first call.

import { PdfError, type CompressTier, type ImagesToPdfOptions, type PageRef, type PdfEngine, type Progress } from './types';
import type { WorkerRequest, WorkerResponse, WorkerResultValue } from './worker';

export * from './types';

// ponytail: one worker for the page's lifetime, shared by every tool call.
// Ceiling: calls queue behind each other inside that single worker — fine
// for this app (one file operation at a time per tab). Upgrade path, if a
// page ever needs true parallelism, is a small pool keyed by `kind`.
let worker: Worker | null = null;

type PendingCall = {
  resolve: (value: WorkerResultValue) => void;
  reject: (err: PdfError) => void;
  onProgress?: Progress;
};

const pending = new Map<number, PendingCall>();
let nextId = 0;

function isWorkerResponse(data: unknown): data is WorkerResponse {
  return typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'number';
}

function handleMessage(event: MessageEvent<unknown>): void {
  const data = event.data;
  if (!isWorkerResponse(data)) return;
  const call = pending.get(data.id);
  if (!call) return;

  switch (data.kind) {
    case 'progress':
      call.onProgress?.(data.done, data.total);
      return;
    case 'result':
      pending.delete(data.id);
      call.resolve(data.value);
      return;
    case 'error':
      pending.delete(data.id);
      call.reject(new PdfError(data.code, data.message, data.filename));
      return;
  }
}

function handleWorkerFailure(reason: string): void {
  // The worker script itself failed to load/evaluate (e.g. a network blip on
  // the chunk, or a browser without module-worker support). Every in-flight
  // call would otherwise hang forever; fail them all with a typed error and
  // drop the dead worker so the next call gets a fresh one.
  const err = new PdfError('corrupt', reason);
  for (const call of pending.values()) call.reject(err);
  pending.clear();
  worker = null;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = (event) => handleWorkerFailure(event.message || 'The PDF engine failed to start.');
    worker.onmessageerror = () => handleWorkerFailure('The PDF engine sent an unreadable message.');
  }
  return worker;
}

function send(request: WorkerRequest, onProgress?: Progress): Promise<WorkerResultValue> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, { resolve, reject, onProgress });
    getWorker().postMessage(request);
  });
}

/** Every call site knows which `op` its own `kind` produces; this just makes that explicit to TS. */
function unwrapPdf(value: WorkerResultValue): { bytes: Uint8Array; filename: string } {
  if (value.op !== 'pdf') throw new PdfError('corrupt', 'Unexpected response from the PDF engine.');
  return value.result;
}

export const merge: PdfEngine['merge'] = async (files: File[], onProgress?: Progress) => {
  const value = await send({ id: nextId++, kind: 'merge', files }, onProgress);
  return unwrapPdf(value);
};

export const organize: PdfEngine['organize'] = async (file: File, pages: PageRef[], onProgress?: Progress) => {
  const value = await send({ id: nextId++, kind: 'organize', file, pages }, onProgress);
  return unwrapPdf(value);
};

export const compress: PdfEngine['compress'] = async (file: File, tier: CompressTier, onProgress?: Progress) => {
  const value = await send({ id: nextId++, kind: 'compress', file, tier }, onProgress);
  return unwrapPdf(value);
};

export const imagesToPdf: PdfEngine['imagesToPdf'] = async (
  images: File[],
  opts: ImagesToPdfOptions,
  onProgress?: Progress,
) => {
  const value = await send({ id: nextId++, kind: 'imagesToPdf', images, opts }, onProgress);
  return unwrapPdf(value);
};

export const pageCount: PdfEngine['pageCount'] = async (file: File) => {
  const value = await send({ id: nextId++, kind: 'pageCount', file });
  if (value.op !== 'count') throw new PdfError('corrupt', 'Unexpected response from the PDF engine.');
  return value.count;
};

export const renderThumbnails: PdfEngine['renderThumbnails'] = async (file: File, onProgress?: Progress) => {
  const value = await send({ id: nextId++, kind: 'renderThumbnails', file }, onProgress);
  if (value.op !== 'thumbnails') throw new PdfError('corrupt', 'Unexpected response from the PDF engine.');
  // The contract hands back object URLs, not Blobs, so the caller (Agent B's
  // UI) can drop them straight into an <img src>. Ownership passes to the
  // caller here too: per types.ts, revoking them is the caller's job.
  return value.blobs.map((blob) => URL.createObjectURL(blob));
};

export const hasTextLayer: PdfEngine['hasTextLayer'] = async (file: File) => {
  const value = await send({ id: nextId++, kind: 'hasTextLayer', file });
  if (value.op !== 'text-layer') throw new PdfError('corrupt', 'Unexpected response from the PDF engine.');
  return value.hasText;
};
