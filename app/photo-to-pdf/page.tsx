import type { Metadata } from "next";
import PhotoTool from "./tool";

export const metadata: Metadata = {
  title: "Photo to PDF",
  description:
    "Turn photos and scans into one PDF, in your browser. Nothing is uploaded.",
};

export default function Page() {
  return <PhotoTool />;
}
