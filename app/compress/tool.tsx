"use client";

import { useState } from "react";
import ToolShell, { Segmented } from "@/components/ToolShell";
import { compress, type CompressTier } from "@/lib/pdf";

const tiers: { value: CompressTier; label: string; detail: string }[] = [
  {
    value: "low",
    label: "Light",
    detail: "Photos stay sharp. The saving is modest.",
  },
  {
    value: "recommended",
    label: "Recommended",
    detail: "The balance most documents want — much smaller, still clearly legible.",
  },
  {
    value: "strong",
    label: "Strong",
    detail: "The smallest file. Photos and fine print get visibly softer.",
  },
];

export default function CompressTool() {
  const [tier, setTier] = useState<CompressTier>("recommended");

  return (
    <ToolShell
      title="Reduce size"
      lede="Shrink a heavy PDF so it fits in an email or an upload limit. Documents with real text keep it — only the images are re-encoded."
      accept="application/pdf"
      noun="a PDF"
      cta="Reduce size"
      noReductionMessage="There was nothing here worth shrinking. The weight in a PDF is almost always its photos and scans — a document that is mostly text is already about as compact as this format gets."
      options={() => <Segmented label="How much" value={tier} onChange={setTier} options={tiers} />}
      run={(files, onProgress) => compress(files[0], tier, onProgress)}
    />
  );
}
