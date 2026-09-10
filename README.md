# Pinto PDF

Four PDF tools that run entirely in your browser: **merge**, **reduce size**,
**organize pages**, and **photo → PDF**.

**Your files never leave your device.** There is no backend, no upload endpoint, and no
account. Every byte of work happens in a Web Worker on your own machine — you can
disconnect from the network after the page loads and all four tools still work.

## Why no server

Most online PDF tools upload your documents to someone else's computer. That is a real
cost for them and a real risk for you: contracts, passports, and medical scans are
exactly the kind of thing people put through these sites.

Doing it client-side removes the risk instead of promising to manage it. It also means
hosting is a static file server, so running this costs nothing and stays free no matter
how many people use it.

The trade-off is honest: very large PDFs (roughly >200MB) and older phones will
struggle, because your device does the work.

## The tools

| Tool | What it does |
|---|---|
| **Merge** | Concatenate several PDFs in the order you choose |
| **Reduce size** | Shrink a PDF — see below, it is more interesting than it sounds |
| **Organize pages** | Reorder, delete and rotate pages on a thumbnail grid, with undo |
| **Photo → PDF** | Turn JPEG/PNG images into a PDF, honouring EXIF rotation |

## How "reduce size" actually works

Two strategies. **The document picks, not the user.**

**If the PDF has a text layer**, only its images are touched. Each `/DCTDecode` image is
decoded, downscaled, re-encoded and written back; every other object in the file is left
byte-for-byte alone. Your text stays selectable and searchable.

**If it has no text layer** — a scan, in other words — the page is rasterized. Nothing
can be lost that isn't already a picture, so this compresses hardest. Each tier is a
*ladder* of (scale, quality) steps: if one step fails to shrink the file, it drops to the
next.

Measured by the calibration table on `/selftest`:

| document | light | recommended | strong |
|---|---|---|---|
| text-only | no change | no change | no change |
| scan | -33% | -50% | -65% |
| scan already at 144 DPI | -21% | -49% | -68% |
| text + photo | -43% | -66% | -80% |
| oversampled raster | -96% | -98% | -99% |

**A text-only PDF genuinely cannot be shrunk this way.** Rasterizing one measures ~340x
its original size, so the tool leaves the file alone and tells you why, rather than
handing you a pointless download. Text PDFs are already about as compact as the format
allows.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. `/selftest` runs the real engine against generated
fixtures and prints the compression calibration table — it is the fastest way to check a
build is healthy.

## Deploy

`next build` produces `out/` — about 4MB of plain files, no Node process at runtime.
That is the whole deploy artifact, which is why every option below is cheap: there is no
server to run, only files to hand out.

**One host requirement that is easy to miss:** `.mjs` must be served as JavaScript.
pdf.js's worker is an `.mjs` module and nginx's stock `mime.types` has no entry for it,
so it goes out as `application/octet-stream` and the browser refuses the import. Only
compression breaks — the other three tools keep working — so it reads as an engine bug
rather than a server config bug. Vercel and Cloudflare Pages already get this right; the
`Dockerfile` patches it for the self-hosted path.

### Cloudflare Pages or Vercel

Connect the repo. Build command `npm run build`, output directory `out`. No environment
variables, no build overrides, no functions. Every push to `main` redeploys.

### Self-hosted

```bash
docker build -t pinto-pdf .
docker run -d --restart unless-stopped -p 8080:80 --name pinto pinto-pdf
```

To expose it from a home machine, use a **Cloudflare Tunnel rather than port
forwarding**:

```bash
cloudflared tunnel create pinto
cloudflared tunnel route dns pinto pdf.example.com
cloudflared tunnel run --url http://localhost:8080 pinto
```

The tunnel dials *out* to Cloudflare, so no inbound ports open on the router, the home
IP never appears in public DNS, TLS terminates at Cloudflare, and a dynamic IP stops
mattering. Port forwarding gives up all four. `cloudflared service install` makes it
survive a reboot.

Worth being clear that self-hosting a static public site adds a machine that has to stay
up and gains nothing a CDN wasn't already doing for free. Do it to own the metal, not
for the site's sake.

### After deploying

Open `/selftest` on the live URL and confirm 9/9. It runs the real engine, so it tests
the deployed bundle rather than a status page — this is what caught the `.mjs` problem
above. Then put a real scanned PDF through `/compress` and a phone photo through
`/photo-to-pdf`: EXIF rotation and compression legibility are the two things synthetic
fixtures cannot prove.

## Built with

`next`, `react`, `pdf-lib`, `pdfjs-dist`. That is the entire dependency list, and it is
deliberate — no drag-and-drop library, no wasm bundle, no UI kit.

The compression work that keeps text intact was originally planned as a ~10MB
`mupdf-wasm` payload. pdf-lib already exposes the PDF object graph, so it turned out to
be about a hundred lines and no new dependency.

## Limitations

- Password-protected PDFs are rejected with a clear error; there is no password prompt.
- Flate-encoded images are left alone — usually screenshots and line art, where the
  saving is small and the decoding risk (predictors, CMYK, indexed palettes) is not.
- No OCR, no form filling, no signing, no page extraction to other formats.
