// STUB. Agent A replaces the body of every function here with a real implementation
// (delegating to the Web Worker). The exported signatures must not change.
// Agent B builds the entire UI against this stub, including its error states.

import type {
  CompressTier,
  ImagesToPdfOptions,
  PageRef,
  PdfEngine,
  PdfResult,
  Progress,
} from './types';

export * from './types';

const notImplemented = (): never => {
  throw new Error('lib/pdf: not implemented yet (Agent A)');
};

export const merge: PdfEngine['merge'] = (_files: File[], _onProgress?: Progress): Promise<PdfResult> =>
  notImplemented();

export const organize: PdfEngine['organize'] = (
  _file: File,
  _pages: PageRef[],
  _onProgress?: Progress,
): Promise<PdfResult> => notImplemented();

export const compress: PdfEngine['compress'] = (
  _file: File,
  _tier: CompressTier,
  _onProgress?: Progress,
): Promise<PdfResult> => notImplemented();

export const imagesToPdf: PdfEngine['imagesToPdf'] = (
  _images: File[],
  _opts: ImagesToPdfOptions,
  _onProgress?: Progress,
): Promise<PdfResult> => notImplemented();

export const pageCount: PdfEngine['pageCount'] = (_file: File): Promise<number> => notImplemented();

export const renderThumbnails: PdfEngine['renderThumbnails'] = (
  _file: File,
  _onProgress?: Progress,
): Promise<string[]> => notImplemented();

export const hasTextLayer: PdfEngine['hasTextLayer'] = (_file: File): Promise<boolean> =>
  notImplemented();
