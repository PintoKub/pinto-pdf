import type { Metadata } from "next";
import CompressTool from "./tool";

export const metadata: Metadata = {
  title: "Reduce PDF size",
  description:
    "Shrink a PDF down to an emailable size, in your browser. Nothing is uploaded.",
};

export default function Page() {
  return <CompressTool />;
}
