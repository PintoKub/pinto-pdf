import type { Metadata } from "next";
import OrganizeTool from "./tool";

export const metadata: Metadata = {
  title: "Organize PDF pages",
  description:
    "Reorder, rotate and delete PDF pages in your browser. Nothing is uploaded.",
};

export default function Page() {
  return <OrganizeTool />;
}
