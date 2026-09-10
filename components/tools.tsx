import type { ReactNode } from "react";

/** Monoline glyphs, 24x24, 1.5px stroke — the only decoration on the tiles. */
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export type Tool = {
  href: string;
  name: string;
  blurb: string;
  glyph: ReactNode;
};

export const tools: Tool[] = [
  {
    href: "/merge",
    name: "Merge PDFs",
    blurb: "Put several documents together in the order you choose.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
        <rect x="2.5" y="4" width="11" height="14" rx="2" {...stroke} />
        <rect x="10.5" y="6" width="11" height="14" rx="2" {...stroke} />
      </svg>
    ),
  },
  {
    href: "/compress",
    name: "Reduce size",
    blurb: "Shrink a heavy PDF down to something you can actually email.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
        <path d="M12 3v6m0 0 3-3m-3 3L9 6" {...stroke} />
        <path d="M12 21v-6m0 0 3 3m-3-3-3 3" {...stroke} />
        <path d="M3 12h18" {...stroke} />
      </svg>
    ),
  },
  {
    href: "/organize",
    name: "Organize pages",
    blurb: "Reorder, rotate and delete pages on a grid you can drag.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" {...stroke} />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" {...stroke} />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" {...stroke} />
        <path d="M17.25 13.5v7.5m0 0 2.5-2.5m-2.5 2.5-2.5-2.5" {...stroke} />
      </svg>
    ),
  },
  {
    href: "/photo-to-pdf",
    name: "Photo to PDF",
    blurb: "Turn a pile of photos or scans into one tidy document.",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" {...stroke} />
        <circle cx="8.5" cy="10" r="1.75" {...stroke} />
        <path d="m3.5 17 4.75-4.25a2 2 0 0 1 2.7 0L15 17" {...stroke} />
        <path d="m13.5 15 2.4-2.1a2 2 0 0 1 2.7.05L21 15.5" {...stroke} />
      </svg>
    ),
  },
];
