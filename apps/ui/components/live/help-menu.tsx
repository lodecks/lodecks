import { BookOpen, ChevronDown, ExternalLink, FileText, Keyboard, Rocket, Scale, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/utils/classes.util";

const Links = [
  { label: "docs", href: "/docs", icon: BookOpen, hint: "everything" },
  { label: "quickstart", href: "/docs/quickstart", icon: Rocket },
  { label: "commands", href: "/docs/live/decks", icon: FileText, hint: "deck, mixer, visuals" },
  { label: "keys", href: "/docs/live/editor", icon: Keyboard, hint: "run, split, panic" }
];

const About = [
  { label: "open source", href: "/docs/about/open-source", icon: Scale, hint: "AGPL-3.0" },
  { label: "terms of service", href: "/docs/about/terms", icon: FileText },
  { label: "privacy", href: "/docs/about/privacy", icon: Shield }
];

/** The help menu: the docs (in a new tab, so the set keeps playing) */
export const HelpMenu = ({ className }: { className?: string }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const item = (link: (typeof Links)[number]) => (
    <a
      key={link.href}
      href={link.href}
      target="_blank"
      rel="noreferrer"
      onClick={() => setOpen(false)}
      className="text-bright flex items-center gap-2 px-3 py-1 hover:bg-white/[0.05]"
    >
      <link.icon size={13} strokeWidth={1.75} className="text-dim shrink-0" />
      {link.label}
      {link.hint && <span className="text-dim ml-auto text-[11px] whitespace-nowrap">{link.hint}</span>}
    </a>
  );

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        className="text-text hover:text-bright flex h-full items-center gap-1 rounded-[3px] px-2 hover:bg-white/[0.05]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        help
        <ChevronDown size={12} strokeWidth={1.75} className="text-dim" />
      </button>
      {open && (
        <div className="border-line-strong absolute top-8 left-0 z-50 w-72 rounded-[4px] border bg-[#0b0f17] py-1 text-[12px] shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          {Links.map(item)}
          <div className="bg-line my-1 h-px" />
          {About.map(item)}
          <div className="text-dim flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-[10px]">
            <ExternalLink size={10} strokeWidth={1.75} className="shrink-0" /> opens in a new tab · help() for the cheat sheet
          </div>
        </div>
      )}
    </div>
  );
};
