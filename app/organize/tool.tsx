"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import ToolShell from "@/components/ToolShell";
import { organize, renderThumbnails, PdfError, type PageRef } from "@/lib/pdf";

const controlClass =
  "text-soft hover:text-ink hover:border-accent border-hairline rounded-full border px-2 py-1 text-[13px] leading-none transition-colors disabled:opacity-30";

function PageGrid({
  file,
  pages,
  setPages,
}: {
  file: File;
  pages: PageRef[];
  setPages: Dispatch<SetStateAction<PageRef[]>>;
}) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [past, setPast] = useState<PageRef[][]>([]);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    let urls: string[] = [];
    setStatus("loading");
    setPast([]);
    void (async () => {
      try {
        urls = await renderThumbnails(file);
        if (!current) return;
        setThumbnails(urls);
        setPages(urls.map((_, index) => ({ pageIndex: index, rotation: 0 })));
        setStatus("ready");
      } catch (thrown) {
        if (!current) return;
        setMessage(
          thrown instanceof Error ? thrown.message : "This PDF could not be read.",
        );
        setStatus("error");
      }
    })();
    // The contract puts revoking on us.
    return () => {
      current = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [file, setPages]);

  function apply(next: PageRef[]) {
    setPast((history) => [...history, pages]);
    setPages(next);
  }

  function moveTo(from: number, to: number) {
    if (from === to) return;
    const next = [...pages];
    const [page] = next.splice(from, 1);
    next.splice(to, 0, page);
    apply(next);
  }

  function rotate(index: number) {
    apply(
      pages.map((page, i) =>
        i === index
          ? { ...page, rotation: ((page.rotation + 90) % 360) as PageRef["rotation"] }
          : page,
      ),
    );
  }

  function undo() {
    if (past.length === 0) return;
    setPages(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }

  if (status === "loading") {
    return <p className="text-soft text-[15px]">Reading pages…</p>;
  }

  if (status === "error") {
    return (
      <p
        role="alert"
        className="text-danger border-danger/30 rounded-[14px] border px-4 py-3 text-[15px] leading-6"
      >
        {message}
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">
            {pages.length} of {thumbnails.length} pages
          </h2>
          <p className="text-soft mt-1 text-[13px]">
            Drag a page to move it, or use the arrows. This grid is the document you
            will get.
          </p>
        </div>
        <button
          type="button"
          onClick={undo}
          disabled={past.length === 0}
          className="text-accent hover:text-accent-hover text-[15px] transition-colors disabled:opacity-30"
        >
          Undo
        </button>
      </div>

      {pages.length === 0 ? (
        <p className="border-hairline text-soft mt-6 rounded-[18px] border border-dashed px-4 py-10 text-center text-[15px]">
          Every page is deleted. Undo to bring one back.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((page, index) => (
            <li
              key={`${page.pageIndex}-${index}`}
              draggable
              onDragStart={() => setDragging(index)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) moveTo(dragging, index);
                setDragging(null);
              }}
              className={`bg-surface border-hairline rounded-[14px] border p-3 ${
                dragging === index ? "opacity-40" : ""
              }`}
            >
              <div className="flex aspect-square items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnails[page.pageIndex]}
                  alt={`Page ${page.pageIndex + 1}`}
                  style={{ transform: `rotate(${page.rotation}deg)` }}
                  className="max-h-full max-w-full transition-transform"
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-1">
                <span className="text-soft text-[13px]">{index + 1}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveTo(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move page ${index + 1} earlier`}
                    className={controlClass}
                  >
                    &larr;
                  </button>
                  <button
                    type="button"
                    onClick={() => rotate(index)}
                    aria-label={`Rotate page ${index + 1}`}
                    className={controlClass}
                  >
                    &#8635;
                  </button>
                  <button
                    type="button"
                    onClick={() => apply(pages.filter((_, i) => i !== index))}
                    aria-label={`Delete page ${index + 1}`}
                    className={controlClass}
                  >
                    &times;
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTo(index, index + 1)}
                    disabled={index === pages.length - 1}
                    aria-label={`Move page ${index + 1} later`}
                    className={controlClass}
                  >
                    &rarr;
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OrganizeTool() {
  const [pages, setPages] = useState<PageRef[]>([]);

  return (
    <ToolShell
      title="Organize pages"
      lede="Reorder, rotate and delete pages. What the grid shows is what the saved file contains."
      accept="application/pdf"
      noun="a PDF"
      cta="Save PDF"
      options={(files) => (
        <PageGrid file={files[0]} pages={pages} setPages={setPages} />
      )}
      run={(files, onProgress) => {
        if (pages.length === 0) {
          throw new PdfError("empty", "no pages selected", files[0].name);
        }
        return organize(files[0], pages, onProgress);
      }}
    />
  );
}
