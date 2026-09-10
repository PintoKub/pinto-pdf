import type { Metadata } from "next";
import Link from "next/link";
import { tools } from "@/components/tools";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pinto PDF — PDF tools that run in your browser",
    template: "%s — Pinto PDF",
  },
  description:
    "Merge, compress, organize and build PDFs entirely on your own device. Nothing uploads, nothing is stored.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-canvas text-ink flex min-h-full flex-col font-sans">
        <header className="nav-blur border-hairline sticky top-0 z-50 border-b">
          <nav className="mx-auto flex h-11 max-w-[980px] items-center gap-6 overflow-x-auto px-5 text-[12px]">
            <Link href="/" className="text-ink shrink-0 font-semibold tracking-tight">
              Pinto PDF
            </Link>
            {tools.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="text-soft hover:text-ink shrink-0 transition-colors"
              >
                {tool.name}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-hairline border-t">
          <div className="text-soft mx-auto max-w-[980px] px-5 py-8 text-[12px] leading-5">
            <p className="text-ink">
              Pinto PDF works entirely inside this browser tab.
            </p>
            <p className="mt-1">
              Your documents are never sent to a server, so there is no upload, no
              account, and nothing for us to keep.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
