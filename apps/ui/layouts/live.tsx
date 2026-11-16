import { InlineHost, LiveBackground, LiveFullVisual } from "@/components/live/inline";
import { LiveEditors } from "@/components/live/split";
import { LiveMenu, LiveStatus } from "@/components/live/menu";
import { CommandPalette } from "@/components/partial/command-palette";
import { ImportPanel } from "@/components/partial/import-panel";
import { Unlock } from "@/components/partial/unlock";
import { useDropToImport } from "@/hooks/import.hook";

/**
 * /play: the performance as text. A line of info on top, the set filling
 * the screen, and whatever the code shows drawn inline under its line.
 */
export const LayoutLive = () => {
  // a song dropped anywhere becomes a pack
  useDropToImport();
  return (
  <div className="bg-ink relative flex h-screen flex-col">
    {/* visuals set with .background() sit under everything else */}
    <LiveBackground />
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <LiveMenu />
      <main className="relative flex min-h-0 flex-1">
        <LiveEditors />
      </main>
      <LiveStatus />
    </div>
    <InlineHost />
    <LiveFullVisual />
    <ImportPanel />
    <CommandPalette />
    <Unlock />
  </div>
  );
};
