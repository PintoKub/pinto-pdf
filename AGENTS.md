<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Pinto PDF — project rules

All-in-one PDF tool site. Four tools: **Merge**, **Reduce size**, **Organize pages**, **Photo → PDF**.
Full plan in `PLAN.md`. Read it before writing code.

## The one architectural rule

**Everything runs in the browser. There is no backend.** Files never upload.
`pdf-lib` + `pdfjs-dist` do all the work in a Web Worker.

## Hard constraints — violating any of these is an automatic review reject

- **No new dependencies.** The four allowed packages are already installed: `next`,
  `react`, `pdf-lib`, `pdfjs-dist`. Adding anything else requires the reviewer's approval
  *before* you install it — ask, don't install-then-ask.
- **No backend.** No `app/api/**`, no route handlers, no server actions, no `"use server"`,
  no database, no file upload endpoint, no environment variables.
- **No `any`.** TypeScript strict mode. `npx tsc --noEmit` must pass clean.
- **`lib/pdf/types.ts` is read-only for both agents.** It is the contract between them.
  If you need it changed, stop and ask the reviewer.
- **No speculative abstraction.** No interface with one implementation, no factory, no
  `utils.ts` dumping ground, no config object for a value that never changes.
- **Stay in your lane.** Each agent owns specific directories (below). Do not create or
  edit files outside them.

## Ownership

| Path | Owner |
|---|---|
| `lib/pdf/types.ts` | reviewer — **read-only to agents** |
| `lib/pdf/**` (everything else), `app/selftest/**` | Agent A (Engine) |
| `app/**` (except `app/selftest/**`), `components/**` | Agent B (Shell) |
| `package.json`, `PLAN.md`, `AGENTS.md` | reviewer |

## Before you say you're done

Run both, and paste the real output — do not claim success without it:

```
npx tsc --noEmit
npm run build
```

Report honestly. A failing build reported as passing is worse than a failing build.
