import { ComponentType, lazy, Suspense, useEffect, useState } from "react";

/**
 * Examples that play (see try-box.tsx). They need the engine, which only
 * loads in the browser: the server renders the code, the browser swaps in
 * the playable box.
 */
const TryBox = lazy(() => import("./try-box"));
const Host = lazy(() => import("@/components/live/inline").then((module) => ({ default: module.InlineHost as ComponentType })));

const useMounted = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
};

const Placeholder = ({ code }: { code: string }) => (
  <div className="not-prose my-5 overflow-hidden rounded-[6px] border border-[#1c2433] bg-[#03050a] font-mono text-[12px]">
    <div className="flex h-9 items-center border-b border-[#1c2433] px-2 text-[11px] text-[#56627a]">loading…</div>
    <pre className="m-0 px-4 py-3 whitespace-pre-wrap text-[#c9d3e6]">{code}</pre>
  </div>
);

export const Try = (props: { code: string; label?: string }) => {
  const mounted = useMounted();
  if (!mounted) return <Placeholder code={props.code} />;
  return (
    <Suspense fallback={<Placeholder code={props.code} />}>
      <TryBox {...props} />
    </Suspense>
  );
};

/** Draws what the examples show (decks, pads, visuals) into their lines */
export const TryHost = () => {
  const mounted = useMounted();
  if (!mounted) return null;
  return (
    <Suspense>
      <Host />
    </Suspense>
  );
};
