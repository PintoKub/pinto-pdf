"use client";

import { useState } from "react";
import ToolShell, { Segmented } from "@/components/ToolShell";
import { imagesToPdf } from "@/lib/pdf";

type PageSize = "fit" | "a4";

const sizes: { value: PageSize; label: string; detail: string }[] = [
  {
    value: "fit",
    label: "Match the photo",
    detail: "Every page comes out the exact shape of the photo on it.",
  },
  {
    value: "a4",
    label: "A4 portrait",
    detail: "Every photo is centred on a standard A4 page, ready to print.",
  },
];

export default function PhotoTool() {
  const [pageSize, setPageSize] = useState<PageSize>("fit");
  const [margin, setMargin] = useState(0);

  return (
    <ToolShell
      title="Photo to PDF"
      lede="Turn photos and scans into a single document. They appear in the order you list them here."
      accept="image/jpeg,image/png,image/webp"
      noun="photos"
      multiple
      cta="Build PDF"
      options={() => (
        <>
          <Segmented
            label="Page shape"
            value={pageSize}
            onChange={setPageSize}
            options={sizes}
          />
          <div className="mt-8">
            <label htmlFor="margin" className="text-[17px] font-semibold">
              White border
            </label>
            <input
              id="margin"
              type="range"
              min={0}
              max={72}
              step={6}
              value={margin}
              onChange={(event) => setMargin(Number(event.target.value))}
              className="accent-accent mt-4 block w-full max-w-[520px]"
            />
            <p className="text-soft mt-2 text-[13px]">
              {margin === 0
                ? "Edge to edge, no border."
                : `About ${Math.round(margin / 2.835)} mm around each photo.`}
            </p>
          </div>
        </>
      )}
      run={(files, onProgress) => imagesToPdf(files, { pageSize, margin }, onProgress)}
    />
  );
}
