import Link from "next/link";
import { tools } from "@/components/tools";

const facts = [
  {
    term: "Nothing uploads",
    detail:
      "Every page is read, rewritten and saved by code running in this tab. No server ever receives the file.",
  },
  {
    term: "Nothing is stored",
    detail:
      "There is no database and no account. Close the tab and the document is gone from here entirely.",
  },
  {
    term: "It keeps working offline",
    detail:
      "Once the page has loaded, the tools run without a connection. Airplane mode is a fine place to merge a PDF.",
  },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-[980px] px-5 pt-24 pb-20 text-center sm:pt-32 sm:pb-28">
        <h1 className="display mx-auto max-w-[15ch] text-balance">
          Your files never leave your device.
        </h1>
        <p className="lede text-soft mx-auto mt-6 max-w-[52ch]">
          Merge, compress, organize and build PDFs right here in the browser. No
          upload, no account, no waiting on a queue.
        </p>
        <p className="mt-6">
          <Link
            href="#tools"
            className="text-accent hover:text-accent-hover text-[17px] transition-colors"
          >
            Pick a tool&nbsp;&rsaquo;
          </Link>
        </p>
      </section>

      <section id="tools" className="mx-auto max-w-[980px] scroll-mt-16 px-5 pb-24">
        <ul className="grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="bg-surface border-hairline hover:border-accent group flex h-full flex-col rounded-[18px] border p-7 transition-colors"
              >
                <span className="text-accent">{tool.glyph}</span>
                <span className="mt-5 text-[21px] font-semibold tracking-tight">
                  {tool.name}
                </span>
                <span className="text-soft mt-2 text-[15px] leading-6">
                  {tool.blurb}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-hairline border-t">
        <div className="mx-auto max-w-[980px] px-5 py-20 sm:py-24">
          <h2 className="title max-w-[18ch] text-balance">
            Privacy here is architecture, not a policy.
          </h2>
          <dl className="mt-12 max-w-[62ch]">
            {facts.map((fact) => (
              <div
                key={fact.term}
                className="border-hairline border-t py-6 sm:flex sm:gap-10"
              >
                <dt className="text-[17px] font-semibold sm:w-[13rem] sm:shrink-0">
                  {fact.term}
                </dt>
                <dd className="text-soft mt-2 text-[15px] leading-6 sm:mt-0">
                  {fact.detail}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-soft mt-8 max-w-[62ch] text-[13px] leading-5">
            The trade-off: your device does the work. Files over roughly 200 MB, or
            an older phone, may run out of memory.
          </p>
        </div>
      </section>
    </>
  );
}
