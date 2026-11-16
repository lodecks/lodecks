import {
  ArrowBigUp,
  AudioLines,
  CircleDot,
  CircleX,
  Infinity as InfinityLucide,
  LucideProps,
  Repeat,
  Star
} from "lucide-react";

import { TrackType } from "@/common/schemas/pack.schema";

import { cn } from "~/utils/classes.util";

// the same stroke everywhere, thin like the rest of the interface
const defaults = { size: 13, strokeWidth: 1.75 } satisfies LucideProps;

const TrackIcons = { loop: Repeat, oneshot: CircleDot, stem: AudioLines };

/** loop · oneshot · stem */
export const TrackIcon = ({ type, ...props }: LucideProps & { type: TrackType }) => {
  const Icon = TrackIcons[type];
  return <Icon {...defaults} {...props} className={cn("inline-block shrink-0", props.className)} />;
};

/** the shift key, for stem pads */
export const ShiftIcon = (props: LucideProps) => (
  <ArrowBigUp {...defaults} {...props} className={cn("inline-block shrink-0", props.className)} />
);

/** favourite: filled when on */
export const FavoriteIcon = ({ on, ...props }: LucideProps & { on?: boolean }) => (
  <Star
    {...defaults}
    size={props.size ?? 12}
    {...props}
    fill={on ? "currentColor" : "none"}
    className={cn("inline-block shrink-0", props.className)}
  />
);

export const InfinityIcon = (props: LucideProps) => (
  <InfinityLucide {...defaults} {...props} className={cn("inline-block shrink-0", props.className)} />
);

export const ErrorIcon = (props: LucideProps) => (
  <CircleX {...defaults} size={props.size ?? 12} {...props} className={cn("inline-block shrink-0 align-[-2px]", props.className)} />
);

export const IconProps = defaults;
