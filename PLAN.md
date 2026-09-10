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
| Framework | Next.js 16, App Router, TypeScript strict | Static export, good worker story |
| Styling | Tailwind CSS 4 | No component kit to fight |
| Hosting | Any static file server | `output: "export"` — see §8 |
| Rendering | Fully static, no SSR data | Every tool page is a client component after the shell |

### Libraries (4 total)
| Package | Used for |
|---|---|
| `pdf-lib` | Merge, reorder/delete/rotate pages, build PDF from images, write output |
| `pdfjs-dist` | Render page thumbnails (Organize UI) + rasterize pages (Compress) |

Both a drag-and-drop library and a drag-to-reorder library were considered and neither
was added — native HTML5 DnD covered both. Anything beyond these two has to prove the
native version failed first.

### Explicitly NOT used
No database. No auth. No Stripe. No blob storage. No queue. No server actions. No API
routes. No Ghostscript container. No file-upload endpoint. No wasm bundle.

Docker is used for **self-hosting the static output only** — there is still no backend
in the image, just nginx handing out files.

### Ops
- Analytics — not yet; it is a dependency for a question nobody is asking
- Domain — `*.pages.dev` / `*.vercel.app` is fine to launch on

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

## 4. The contract

`lib/pdf/types.ts` is the seam between the UI and the engine, and it is the one file
worth reading first. Two decisions in it still shape everything above:

**`organize` takes the full desired page list**, so reorder, delete and rotate are one
function instead of three. Fewer functions, fewer states, one undo model in the UI.

**Rotation is absolute, not relative.** A page carries the rotation it should end up
with, so the UI never has to track how many times a button was pressed.

The engine runs in a Web Worker over raw `postMessage` with a request-id map — no
Comlink. Note that structured clone strips `Error` subclasses, so `PdfError` is
rehydrated on the main thread from `{code, message, filename}`; that is not obvious and
is easy to reintroduce as a bug.

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
