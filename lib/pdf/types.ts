// THE CONTRACT. Owned by the reviewer (Opus).
// Neither agent edits this file. Request changes through the reviewer.

/** One page in a desired output document. */
export type PageRef = {
  /** Index into the source document, 0-based. */
  pageIndex: number;
  rotation: 0 | 90 | 180 | 270;
};

/** Called with (done, total) as work progresses. Never called after resolve/reject. */
export type Progress = (done: number, total: number) => void;

export type PdfResult = {
  bytes: Uint8Array;
  /** Suggested download filename, including the .pdf extension. */
  filename: string;
};

export type CompressTier = 'low' | 'recommended' | 'strong';

export type ImagesToPdfOptions = {
  /** 'fit' = one page per image, sized to the image. 'a4' = centre on A4 portrait. */
  pageSize: 'fit' | 'a4';
  /** Points of whitespace around the image. 0 for edge-to-edge. */
  margin: number;
};

export type PdfErrorCode =
  | 'encrypted'      // password-protected; we do not prompt for passwords in v1
  | 'corrupt'        // not a parseable PDF
  | 'empty'          // 0 bytes, or 0 pages
  | 'unsupported'    // e.g. an image format the browser cannot decode
  | 'too-large'      // ran out of memory
  | 'cancelled';

/** Every rejection from this module is a PdfError. Agent B switches on `code`. */
export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string,
    /** Name of the input file that caused it, when attributable to one. */
    readonly filename?: string,
  ) {
    super(message);
    this.name = 'PdfError';
  }
}

/** The whole public surface of the engine. Agent B imports nothing else from lib/pdf. */
export type PdfEngine = {
  /** Concatenate PDFs in the order given. */
  merge(files: File[], onProgress?: Progress): Promise<PdfResult>;

  /**
   * Rebuild one PDF from an explicit page list.
   * Covers reorder, delete and rotate in a single call: `pages` IS the output document.
   */
  organize(file: File, pages: PageRef[], onProgress?: Progress): Promise<PdfResult>;

  /** Rasterize and re-encode to shrink. Lossy — see hasTextLayer. */
  compress(file: File, tier: CompressTier, onProgress?: Progress): Promise<PdfResult>;

  /** JPEG/PNG/WebP images -> one PDF, one page per image, in the order given. */
  imagesToPdf(images: File[], opts: ImagesToPdfOptions, onProgress?: Progress): Promise<PdfResult>;

  /** Page count without rendering anything. Cheap. */
  pageCount(file: File): Promise<number>;

  /**
   * Thumbnails for the Organize grid, one object URL per page, in page order.
   * The CALLER is responsible for URL.revokeObjectURL on every returned url.
   */
  renderThumbnails(file: File, onProgress?: Progress): Promise<string[]>;

  /** True if the PDF has a real text layer. Used to warn before a lossy compress. */
  hasTextLayer(file: File): Promise<boolean>;
};
