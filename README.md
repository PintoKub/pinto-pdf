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

## Self-host

`next build` produces `out/`, about 4MB of static files. Any file server will do.

```bash
docker build -t pinto-pdf .
docker run -d -p 8080:80 pinto-pdf
```

**One host requirement that is easy to miss:** `.mjs` must be served as JavaScript.
pdf.js's worker is an `.mjs` module and nginx's stock `mime.types` has no entry for it,
so it goes out as `application/octet-stream` and the browser refuses the import. Only
compression breaks — the other three tools keep working — so it looks like an engine bug
rather than a server config bug. The `Dockerfile` patches this. Vercel and Cloudflare
Pages already get it right.

See [PLAN.md](PLAN.md) for the deploy options and the design rationale.

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
