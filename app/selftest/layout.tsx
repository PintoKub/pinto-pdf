import type { Metadata } from 'next';

// ponytail: page.tsx is a client component and so cannot export metadata.
// /selftest is a diagnostic — useful to open on a live URL, not something
// anyone should land on from a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SelftestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
