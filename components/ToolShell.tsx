"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PdfError, type PdfErrorCode, type PdfResult, type Progress } from "@/lib/pdf";

const errorMessages: Record<PdfErrorCode, string> = {
  encrypted: "This PDF is password-protected. Remove the password, then try again.",
  corrupt: "This file isn't a readable PDF.",
  empty: "This file has no pages in it.",
  unsupported: "This file type isn't one the browser can open.",
  "too-large": "This file needs more memory than this device has. Try a smaller one.",
  cancelled: "Stopped before finishing.",
};

function describe(error: unknown): string {
  if (error instanceof PdfError) {
    const message = errorMessages[error.code];
    return error.filename ? `${error.filename}: ${message}` : message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Does the file match the `accept` string, allowing browsers that report no type? */
function accepted(file: File, accept: string): boolean {
  if (!file.type) return true;
  return accept.split(",").some((entry) => {
    const type = entry.trim();
    return type.endsWith("/*")
      ? file.type.startsWith(type.slice(0, -1))
      : file.type === type;
  });
}

export type ToolShellProps = {
  title: string;
  lede: string;
  /** MIME accept string, e.g. "application/pdf" or "image/jpeg,image/png". */
  accept: string;
  /** Human name for what the dropzone takes, e.g. "PDFs". */
  noun: string;
  multiple?: boolean;
  cta: string;
  /** Rendered between the file list and the run button. */
  options?: (files: File[]) => ReactNode;
  run: (files: File[], onProgress: Progress) => Promise<PdfResult>;
  /**
   * Shown instead of a download link when the output is no smaller than the
   * input. Only compress passes this: for the other tools "output >= input" is
   * a normal outcome (merging two files makes a bigger one) and says nothing.
   */
  noReductionMessage?: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ToolShell({
  title,
  lede,
  accept,
  noun,
  multiple = false,
  cta,
  options,
  run,
  noReductionMessage,
}: ToolShellProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // ponytail: announced in coarse 10% steps, not on every tick, so a screen
  // reader gets occasional progress instead of a flood of near-identical reads.
  const [announced, setAnnounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; filename: string; inputBytes: number; outputBytes: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The object URL is the only thing here that leaks if we forget it.
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  function add(incoming: FileList | null) {
    if (!incoming) return;
    const picked = Array.from(incoming).filter((file) => accepted(file, accept));
    if (picked.length === 0) {
      setError(`Those aren't ${noun}.`);
      return;
    }
    setError(null);
    setResult(null);
    setFiles((current) => (multiple ? [...current, ...picked] : picked.slice(0, 1)));
  }

  function move(index: number, by: number) {
    setFiles((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function reset() {
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(0);
  }

  async function start() {
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setAnnounced("Working…");
    try {
      const output = await run(files, (done, total) => {
        const value = total > 0 ? done / total : 0;
        setProgress(value);
        setAnnounced((current) => {
          const step = `Working — ${Math.round(value * 10) * 10}% complete.`;
          return step !== current ? step : current;
        });
      });
      // The engine never hands back a SharedArrayBuffer view, so this is safe
      // and avoids copying a large PDF just to satisfy BlobPart.
      const bytes = output.bytes as Uint8Array<ArrayBuffer>;
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const inputBytes = files.reduce((sum, file) => sum + file.size, 0);
      setResult({ url, filename: output.filename, inputBytes, outputBytes: bytes.byteLength });
      setAnnounced("Done. Your PDF is ready.");
    } catch (thrown) {
      setError(describe(thrown));
      setAnnounced("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[980px] px-5 pt-16 pb-24 sm:pt-20">
      <h1 className="title">{title}</h1>
      <p className="lede text-soft mt-4 max-w-[52ch]">{lede}</p>

      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          add(event.dataTransfer.files);
        }}
        className={`bg-surface mt-10 flex cursor-pointer flex-col items-center rounded-[18px] border border-dashed px-6 py-14 text-center transition-colors ${
          dragging ? "border-accent" : "border-hairline"
        } has-[input:focus-visible]:border-accent`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="text-[17px] font-semibold">
          Drop {noun} here, or click to choose
        </span>
        <span className="text-soft mt-2 text-[13px]">
          They stay on this device the whole time.
        </span>
      </label>

      {files.length > 0 && (
        <ul className="border-hairline mt-8 rounded-[18px] border">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="border-hairline flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[15px]">{file.name}</span>
              <span className="text-soft shrink-0 text-[13px]">
                {formatSize(file.size)}
              </span>
              {multiple && files.length > 1 && (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || busy}
                    aria-label={`Move ${file.name} earlier`}
                    className="text-soft hover:text-ink px-1 disabled:opacity-30"
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === files.length - 1 || busy}
                    aria-label={`Move ${file.name} later`}
                    className="text-soft hover:text-ink px-1 disabled:opacity-30"
                  >
                    &darr;
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                disabled={busy}
                aria-label={`Remove ${file.name}`}
                className="text-soft hover:text-ink shrink-0 px-1 disabled:opacity-30"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {multiple && files.length > 0 && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-accent hover:text-accent-hover mt-4 text-[15px] transition-colors"
        >
          Add more {noun}
        </button>
      )}

      {files.length > 0 && options && <div className="mt-10">{options(files)}</div>}

      {files.length > 0 && (
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="bg-accent hover:bg-accent-hover rounded-full px-6 py-3 text-[17px] font-medium text-white transition-colors disabled:opacity-50"
          >
            {busy ? "Working…" : cta}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="text-soft hover:text-ink text-[15px] transition-colors disabled:opacity-30"
          >
            Start over
          </button>
        </div>
      )}

      {busy && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="border-hairline mt-6 h-1 overflow-hidden rounded-full border-0 bg-[var(--color-hairline)]"
        >
          <div
            className="bg-accent h-full transition-[width] duration-200"
            style={{ width: `${Math.max(progress * 100, 2)}%` }}
          />
        </div>
      )}

      {/* Visually hidden: the progress bar above is visual-only, so a screen
          reader needs its own polite announcement of the same work. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-danger border-danger/30 mt-8 rounded-[14px] border px-4 py-3 text-[15px] leading-6"
        >
          {error}
        </p>
      )}

      {result &&
        (noReductionMessage && result.outputBytes >= result.inputBytes ? (
          <div className="border-hairline mt-8 rounded-[18px] border p-6">
            <p className="text-[17px] font-semibold">This file is already as small as it gets.</p>
            <p className="text-soft mt-1 text-[13px]">{noReductionMessage}</p>
          </div>
        ) : (
          <div className="border-hairline mt-8 rounded-[18px] border p-6">
            <p className="text-[17px] font-semibold">Your PDF is ready.</p>
            <p className="text-soft mt-1 text-[13px]">
              {formatBytes(result.inputBytes)} → {formatBytes(result.outputBytes)}
              {result.outputBytes < result.inputBytes &&
                ` — ${Math.round((1 - result.outputBytes / result.inputBytes) * 100)}% smaller`}
              . Built here, on this device.
            </p>
            <a
              href={result.url}
              download={result.filename}
              className="bg-accent hover:bg-accent-hover mt-5 inline-block rounded-full px-6 py-3 text-[17px] font-medium text-white transition-colors"
            >
              Download {result.filename}
            </a>
          </div>
        ))}
    </div>
  );
}

/** iOS-style segmented control. Used by the compress and photo tools. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; detail?: string }[];
}) {
  return (
    <fieldset>
      <legend className="text-[17px] font-semibold">{label}</legend>
      <div className="border-hairline mt-4 flex max-w-[520px] gap-1 rounded-[12px] border p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex-1 cursor-pointer rounded-[9px] px-3 py-2 text-center text-[15px] transition-colors has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--color-accent)] ${
              value === option.value ? "bg-accent font-medium text-white" : "text-soft"
            }`}
          >
            <input
              type="radio"
              name={label}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {options.find((option) => option.value === value)?.detail && (
        <p className="text-soft mt-3 text-[13px] leading-5">
          {options.find((option) => option.value === value)?.detail}
        </p>
      )}
    </fieldset>
  );
}
