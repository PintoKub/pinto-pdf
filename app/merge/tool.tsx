"use client";

import ToolShell from "@/components/ToolShell";
import { merge } from "@/lib/pdf";

export default function MergeTool() {
  return (
    <ToolShell
      title="Merge PDFs"
      lede="Combine documents into one file. They come out in the order you list them here."
      accept="application/pdf"
      noun="PDFs"
      multiple
      cta="Merge PDFs"
      run={(files, onProgress) => merge(files, onProgress)}
    />
  );
}
