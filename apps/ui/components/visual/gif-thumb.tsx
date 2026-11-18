import type { GifInfo } from "@/engine/providers/visuals.provider";

/**
 * A gif's picture: an image, or for a video a muted loop with no
 * controls, which only ever plays
 */
export const GifThumb = ({ gif, className }: { gif: Pick<GifInfo, "url" | "video" | "name">; className?: string }) =>
  gif.video ? (
    <video
      src={gif.url}
      className={className}
      muted
      loop
      autoPlay
      playsInline
      disablePictureInPicture
      disableRemotePlayback
      controls={false}
      aria-label={gif.name}
    />
  ) : (
    <img src={gif.url} alt={gif.name} className={className} />
  );
