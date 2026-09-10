# Pinto PDF — Build Plan

All-in-one PDF tool site. Four tools: **Merge**, **Reduce size**, **Organize pages**, **Photo → PDF**.

---

## 1. The one architectural decision

**Everything runs in the browser. There is no backend.**

pdf-lib + pdf.js do all four operations client-side in a Web Worker. Files never leave
the user's machine.

Why this is the right call, not just the lazy one:
- **Privacy is the product.** "Your files never upload" beats iLovePDF/Smallpdf on the
  one axis they can't match. It's a marketing line and an architecture at the same time.
- **Cost is €0 and stays €0.** No egress, no storage, no compute per file. A backend PDF
  service is the single most expensive thing you could build here — big files, CPU-heavy,
  and you'd need virus scanning, TTL cleanup, and abuse rate-limiting on day one.
- **No GDPR/PDPA surface.** Nothing is stored, so nothing is breached.

Cost: fails on very large PDFs (>~200MB) and old phones. Acceptable — that's the 1%.

---

## 2. Infrastructure

### Runtime / hosting
| Thing | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript strict | Same stack you already run on Polymad — zero learning cost |
| Styling | Tailwind CSS 4 | Same as Polymad |
| Hosting | Vercel, free tier | Static pages + a worker bundle. No functions needed |
| Rendering | Fully static (no SSR data) | Every tool page is a client component after the shell |

### Libraries (4 total)
| Package | Used for |
|---|---|
| `pdf-lib` | Merge, reorder/delete/rotate pages, build PDF from images, write output |
| `pdfjs-dist` | Render page thumbnails (Organize UI) + rasterize pages (Compress) |
| `react-dropzone` *(optional)* | Drag-and-drop file intake. Try native `ondrop` first; add only if it fights you |
| `@dnd-kit/core` *(optional)* | Drag-to-reorder page grid. Try native HTML5 DnD first |

The two optional ones are **not pre-approved**. Whoever wants one must first show the
native version failing.

### Explicitly NOT used
No database. No auth. No Supabase. No Stripe. No Vercel Blob / S3. No queue. No Docker.
No server actions. No API routes. No Ghostscript container. No file-upload endpoint.

If any agent proposes one of these, it's a review reject.

### Ops
- Vercel Analytics — one line, tells you which of the four tools people actually use
- Domain — buy later, `*.vercel.app` is fine to launch
- Repo: `~/Documents/Ten/pinto-pdf`, branch per agent

---

## 3. The known-hard part: Reduce size

pdf-lib **cannot** re-compress an existing PDF's streams. Be honest about this up front.

- **v1 approach:** pdf.js renders each page to a canvas → export JPEG at a quality tier →
  pdf-lib rebuilds the PDF from those JPEGs. Real, large size reduction. Works today.
- **The ceiling:** output is raster. Text stops being selectable and searchable. For a
  scanned document this is invisible; for a text PDF it's a real downgrade.
- **v1 mitigation:** detect whether the PDF has an extractable text layer (pdf.js
  `getTextContent()`). If it does, warn the user before compressing.
- **Upgrade path when it matters:** `mupdf-wasm` does true stream recompression and keeps
  text. ~10MB wasm payload, lazy-loaded only on the Compress page. Do this in v2, once
  analytics show Compress is actually used.

Three quality tiers: Low (1.0x scale, q0.75) / Recommended (1.5x, q0.6) / Strong (1.0x, q0.4).
Numbers to be tuned against real files, not guessed.

---

## 4. The seam — how 2 agents don't collide

I write **`lib/pdf/types.ts`** myself, before either agent starts. It is the contract.
Neither agent may edit it; they request changes through me.

```ts
// lib/pdf/types.ts  — the contract. Owned by the reviewer.

export type PageRef = { fileId: string; pageIndex: number; rotation: 0|90|180|270 };

export type Progress = (done: number, total: number) => void;

export type PdfResult = { bytes: Uint8Array; filename: string };

/** Concatenate PDFs in the order given. */
export function merge(files: File[], onProgress?: Progress): Promise<PdfResult>;

/** Rebuild one PDF from an explicit page list — covers reorder, delete AND rotate. */
export function organize(file: File, pages: PageRef[], onProgress?: Progress): Promise<PdfResult>;

/** Rasterize + re-encode to shrink. */
export function compress(file: File, tier: 'low'|'recommended'|'strong', onProgress?: Progress): Promise<PdfResult>;

/** JPEG/PNG images → one PDF. */
export function imagesToPdf(images: File[], opts: { pageSize: 'fit'|'a4'; margin: number }, onProgress?: Progress): Promise<PdfResult>;

/** Thumbnails for the Organize grid. Returns object URLs; caller revokes them. */
export function renderThumbnails(file: File, onProgress?: Progress): Promise<string[]>;

/** True if the PDF has a real text layer — used to warn before lossy compress. */
export function hasTextLayer(file: File): Promise<boolean>;
```

One deliberate simplification: `organize` takes the **full desired page list**, so reorder,
delete, and rotate are one function instead of three. Fewer functions, fewer states, one
undo model in the UI.

I also write a stub `lib/pdf/index.ts` that satisfies these signatures with
`throw new Error('not implemented')`, so Agent B can build and run the whole UI on day one
without waiting for Agent A.

---

## 5. Agent briefs

Both: **Sonnet 5, high effort.** Both work on their own branch. Neither touches the
other's directories. Neither adds a dependency not listed in §2.

### Agent A — Engine
**Owns:** `lib/pdf/**` (except `types.ts`), `lib/pdf/worker.ts`

**Deliver:**
1. Implement all six functions in the contract, against real pdf-lib / pdf.js APIs.
2. Run them inside a Web Worker (raw `postMessage`, no Comlink) so the UI never freezes.
   Main-thread wrapper resolves promises and pipes `onProgress`.
3. Correct handling of: encrypted PDFs (fail with a clear typed error, don't hang),
   0-byte and non-PDF files, mixed page sizes on merge, EXIF-rotated phone photos.
4. **One check that runs:** `lib/pdf/selftest.ts` — generates a 3-page PDF in memory,
   round-trips it through merge → organize → compress, asserts page counts, page order
   after a reorder, and that compress output is smaller. Node script, `node --test` or a
   plain assert `main()`. No test framework install.

**Do not:** write any React, touch `app/`, or design anything.

### Agent B — Shell
**Owns:** `app/**`, `components/**`

**Deliver:**
1. Next.js 16 App Router shell: landing page listing the four tools, plus
   `/merge`, `/compress`, `/organize`, `/photo-to-pdf`.
2. One shared `<ToolShell>` component: dropzone → file list → options slot → Run button →
   progress bar → download. All four pages are thin configurations of it.
3. Organize page: thumbnail grid, drag-to-reorder, per-page delete and rotate, undo.
   Native HTML5 DnD first; justify `@dnd-kit` before adding it.
4. Import only from `lib/pdf` via the contract. The stub throwing is expected — build the
   full UI including error and progress states against it.
5. Visual direction: clean, fast, obviously-not-a-scam-site. No stock illustrations, no
   modal newsletter trap. Privacy line above the fold: *"Files never leave your device."*

**Do not:** touch `lib/pdf/**`, or add a backend, API route, or server action.

---

## 6. My job (reviewer / instructor)

1. **Before start:** write `lib/pdf/types.ts` + throwing stub, scaffold the Next.js app,
   install the four deps, push to `main`. Both agents branch from that.
2. **During:** answer contract questions. Only I edit `types.ts`; a change there is
   announced to both agents.
3. **Review gates, in order:**
   - Gate 1 — Agent A's `selftest.ts` passes on my machine, on a real messy PDF I supply,
     not just a generated one.
   - Gate 2 — Agent B's UI runs end-to-end against the stub, every error state reachable.
   - Gate 3 — Integration: swap the stub for the real engine, run all four tools on real
     files. I do this merge myself; neither agent does it.
4. **Standing reject criteria:** new dependency not in §2; anything under `app/api/`;
   `any` in TypeScript; an abstraction with one caller; a "utils" file.

---

## 7. Milestones

| # | Deliverable | Owner |
|---|---|---|
| 0 | Repo + contract + stub + deps | me |
| 1 | Engine passes selftest / UI runs on stub | A ∥ B |
| 2 | Integration, all four tools on real files | me |
| 3 | Deploy to Vercel, add Analytics | me |
| 4 | *(post-launch, data-driven)* mupdf-wasm for lossless compress | TBD |

---

## 8. Deploy to Vercel

Nothing to configure. No env vars, no functions, no database, no build overrides —
all seven routes are static and every byte of work happens in the visitor's browser.
Free tier covers it, and cost does not scale with usage.

Verified before writing this: `npm run build && next start` serves the production
bundle and `/selftest` passes 8/8 against it, so the Web Worker and the pdf.js worker
asset both survive the production build. That was the only real deploy risk.

### Steps

1. **Push to GitHub.** The repo is local-only right now.
   ```
   gh repo create pinto-pdf --private --source=. --push
   ```

2. **Import on Vercel.** vercel.com → Add New → Project → pick the repo.
   Framework auto-detects as Next.js. Accept every default. Do not add env vars.

3. **Smoke-test the preview URL** before promoting: open `/selftest` on the deployed
   domain and confirm 8/8. It runs the real engine, so it is a genuine end-to-end
   check of the deployed bundle, not a static page. Then put a real scanned PDF
   through `/compress` and a phone photo through `/photo-to-pdf` — EXIF rotation and
   compression legibility are the two things fixtures cannot prove.

4. **Promote to production.** Every push to `main` auto-deploys from then on.

5. **Custom domain** — Vercel dashboard → Domains. Do this whenever, `*.vercel.app`
   is fine to launch on.

### Left deliberately undone

- **`/selftest` ships publicly.** It is harmless, it is the fastest smoke test on a
  deployed URL, and hiding it costs more than it saves. Delete the route if it ever
  bothers you.
- **No analytics yet.** `@vercel/analytics` is a new dependency for a question nobody
  is asking yet. Add it once the site has visitors and you want to know which of the
  four tools they use — that answer decides whether v2 compression is worth building.
- **No error tracking.** Sentry is a real dependency and a real cost for a site with
  no users. Revisit after launch.
