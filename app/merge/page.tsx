import type { Metadata } from "next";
import MergeTool from "./tool";

export const metadata: Metadata = {
  title: "Merge PDFs",
  description:
    "Combine several PDFs into one file, in your browser. Nothing is uploaded.",
};

export default function Page() {
  return <MergeTool />;
}
