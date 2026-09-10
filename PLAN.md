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

## 3. Reduce size — how it actually works

Two strategies. Which one runs is decided by the document, not by the user.

**Documents with a text layer → images only.** Every `/DCTDecode` image XObject is
decoded, downscaled, re-encoded as JPEG and written back; every other object is left
exactly as it was. Text stays selectable and searchable. Implemented with pdf-lib's
object graph (`enumerateIndirectObjects`, `PDFRawStream`) — no extra dependency.
Soft/stencil masks are skipped: they are single-channel alpha, and replacing one with
an RGB JPEG would corrupt the transparency it belongs to.

**Scans with no text layer → rasterize the page.** Nothing can be lost that isn't
already a picture, so this compresses hardest. Each tier is a *ladder* of
(scale, quality) steps: if a step fails to shrink the file, drop to the next. A single
fixed scale silently did nothing on scans already near the target DPI. Above 4x the
original the ladder is abandoned — no lower step can recover from there.

`scale` multiplies the PDF's native 72 DPI, so scale 1.0 is 72 DPI and far too coarse
to read. The light tier starts at 2.0 (144 DPI); the last step of each ladder is that
tier's legibility floor.

**Measured, on `/selftest`'s calibration table:**

| document | light | recommended | strong |
|---|---|---|---|
| text-only | no change | no change | no change |
| scan | -33% | -50% | -65% |
| scan already at 144 DPI | -21% | -49% | -68% |
| text + photo | -43% | -66% | -80% |
| oversampled raster | -96% | -98% | -99% |

A text-only PDF genuinely cannot be reduced this way — rasterizing one measures ~340x
its original size. The UI says so plainly instead of offering a pointless download.

**mupdf-wasm is not needed.** It was the planned v2 for keeping text while compressing,
but pdf-lib's object graph does that already at zero dependency cost and no 10MB wasm
payload. Revisit only for Flate-encoded images, which are currently left alone —
usually screenshots and line art, where the saving is small and the decoding risk
(predictors, CMYK, indexed palettes) is high.

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

## 8. Deploy

`next.config.ts` sets `output: "export"`. The build produces `out/` — 4.2 MB of plain
files, no Node process at runtime. That is the whole deploy artifact, and it is why
every option below is cheap: there is no server to run, only files to hand out.

Verified against the real thing, not assumed: `/selftest` passes 9/9 served by a dumb
static file server *and* out of the nginx container, so the Web Worker and the pdf.js
worker asset both survive a build with no framework runtime behind it.

**One host requirement, and it is easy to miss:** `.mjs` must be served as JavaScript.
pdf.js's worker is an `.mjs` module, and nginx's stock `mime.types` has no entry for it,
so it goes out as `application/octet-stream` and the browser refuses the import. Only
compression breaks — merge, organize and photo-to-PDF still work — so it looks like an
engine bug rather than a server config bug. Vercel and Cloudflare Pages get this right
already; the `Dockerfile` patches `mime.types` for the self-hosted path.

### Option A — Cloudflare Pages (recommended: you already own the domain)

Static files, a domain already in that account, free bandwidth, nothing running at home.

1. `gh repo create pinto-pdf --private --source=. --push`
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
   Build command `npm run build`, output directory `out`.
3. Custom domain → pick your domain. DNS is already there, so it is two clicks and no
   records to copy.

Every push to `main` redeploys. Nothing else to maintain.

### Option B — Vercel

Same repo, same zero configuration; Next.js is auto-detected and `output: "export"` is
respected. Use this if you want Vercel's preview-URL-per-branch flow. The domain then
needs Cloudflare DNS pointed at Vercel, so it is slightly more work than Option A.

### Option C — self-host on the Debian box

Works, and the `Dockerfile` in the repo is built and tested. Understand what it buys:
the site is static and public, so self-hosting adds a machine that has to stay up and
gains nothing a CDN was not already doing for free. Do it to learn or to own the metal,
not for the site's sake.

```
git clone <repo> && cd pinto-pdf
docker build -t pinto-pdf .
docker run -d --restart unless-stopped -p 8080:80 --name pinto pinto-pdf
```

Then expose it with a **Cloudflare Tunnel, not port forwarding**:

```
cloudflared tunnel login
cloudflared tunnel create pinto
cloudflared tunnel route dns pinto pdf.yourdomain.com
cloudflared tunnel run --url http://localhost:8080 pinto
```

Tunnel over port forwarding because the tunnel dials *out* to Cloudflare: no inbound
ports open on your router, your home IP never appears in DNS, TLS terminates at
Cloudflare, and a dynamic IP from your ISP stops mattering. Port forwarding gives up
all four of those. Run `cloudflared` as a systemd service (`cloudflared service
install`) so it survives a reboot.

`git pull && docker build && docker restart` is the update loop. Automate it only once
doing it by hand actually annoys you.

### Smoke test after deploying, whichever option

Open `/selftest` on the live URL and confirm 9/9 — it runs the real engine, so it tests
the deployed bundle rather than a status page. Then put a real scanned PDF through
`/compress` and a phone photo through `/photo-to-pdf`. EXIF rotation and compression
legibility are the two things synthetic fixtures cannot prove.

### Left deliberately undone

- **`/selftest` ships publicly.** Harmless, and the fastest smoke test on a deployed
  URL. Delete the route if it ever bothers you.
- **No CI.** The host builds on push and a red build does not promote. A GitHub Action
  running `tsc` and `lint` would only tell you the same thing earlier.
- **No analytics.** `@vercel/analytics` is a new dependency for a question nobody is
  asking yet. Add it once the site has visitors.
- **No error tracking.** Sentry is a real dependency and a real cost for a site with
  no users. Revisit after launch.
