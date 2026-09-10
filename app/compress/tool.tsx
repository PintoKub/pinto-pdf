"use client";

import { useEffect, useState } from "react";
import ToolShell, { Segmented } from "@/components/ToolShell";
import { compress, hasTextLayer, type CompressTier } from "@/lib/pdf";

const tiers: { value: CompressTier; label: string; detail: string }[] = [
  {
    value: "low",
    label: "Light",
    detail: "Pages stay sharp. The saving is modest.",
  },
  {
    value: "recommended",
    label: "Recommended",
    detail: "The balance most documents want — much smaller, still clearly legible.",
  },
  {
    value: "strong",
    label: "Strong",
    detail: "The smallest file. Fine print and thin lines get visibly softer.",
  },
];

/** Compressing rasterizes the page, so a text PDF loses selectable text. Say so first. */
function TextLayerNotice({ file }: { file: File }) {
  const [hasText, setHasText] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const result = await hasTextLayer(file);
        if (current) setHasText(result);
      } catch {
        // The notice is a courtesy, not a gate. A failed check stays quiet.
      }
    })();
    return () => {
      current = false;
    };
  }, [file]);

  if (!hasText) return null;
  return (
    <p className="border-hairline text-soft mt-6 rounded-[14px] border px-4 py-3 text-[13px] leading-5">
      This PDF has real text in it. Reducing the size redraws every page as an image,
      so the text will no longer be selectable or searchable.
    </p>
  );
}

export default function CompressTool() {
  const [tier, setTier] = useState<CompressTier>("recommended");

  return (
    <ToolShell
      title="Reduce size"
      lede="Redraw a heavy PDF at a lower resolution so it fits in an email or an upload limit."
      accept="application/pdf"
      noun="a PDF"
      cta="Reduce size"
      options={(files) => (
        <>
          <Segmented label="How much" value={tier} onChange={setTier} options={tiers} />
          <TextLayerNotice file={files[0]} />
        </>
      )}
      run={(files, onProgress) => compress(files[0], tier, onProgress)}
    />
  );
}
