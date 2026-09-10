<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Pinto PDF — project rules

All-in-one PDF tool site. Four tools: **Merge**, **Reduce size**, **Organize pages**,
**Photo → PDF**. `README.md` is the overview, the design rationale and the deploy
options. Read it before writing code.

## The one architectural rule

**Everything runs in the browser. There is no backend.** Files never upload.
`pdf-lib` + `pdfjs-dist` do all the work in a Web Worker.

This is the product, not an implementation detail. A change that sends a user's file
anywhere is not a refactor — it removes the only reason to use this over iLovePDF.

## Hard constraints

- **No new dependencies.** Four packages are installed: `next`, `react`, `pdf-lib`,
  `pdfjs-dist`. Anything else needs a case made first — ask, don't install-then-ask.
  Two DnD libraries were considered and rejected because native HTML5 DnD covered it.
- **No backend.** No `app/api/**`, no route handlers, no server actions, no
  `"use server"`, no database, no upload endpoint, no environment variables.
- **`output: "export"` must keep working.** Anything needing a Node runtime breaks
  self-hosting and the static deploy. If you add something that does, say so loudly.
- **No `any`.** TypeScript strict mode. `npx tsc --noEmit` must pass clean.
- **`lib/pdf/types.ts` is the contract** between the UI and the engine. Changing it
  means changing both sides — do that deliberately, not incidentally.
- **No speculative abstraction.** No interface with one implementation, no factory, no
  `utils.ts` dumping ground, no config object for a value that never changes.

## The contract

`lib/pdf/types.ts` is the seam between the UI and the engine, and it is the file to read
first. Two decisions in it shape everything else:

**`organize` takes the full desired page list**, so reorder, delete and rotate are one
function instead of three. Fewer functions, fewer states, one undo model in the UI.

**Rotation is absolute, not relative.** A page carries the rotation it should end up
with, so nothing has to track how many times a button was pressed.

The engine runs in a Web Worker over raw `postMessage` with a request-id map — no
Comlink. Structured clone strips `Error` subclasses, so `PdfError` is rehydrated on the
main thread from `{code, message, filename}`. That is easy to reintroduce as a bug.

## Before you say you're done

Run all three, and paste the real output — do not claim success without it:

```
npx tsc --noEmit
npm run lint
npm run build
```

Then open `/selftest` and confirm 9/9. It runs the real engine, so it catches things a
type check cannot — a broken worker, a detached buffer, a compression tier that silently
stopped compressing.

Report honestly. A failing build reported as passing is worse than a failing build.
