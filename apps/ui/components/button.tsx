import { ButtonHTMLAttributes } from "react";
import { tv } from "tailwind-variants";

import { cn } from "~/utils/classes.util";

export const ButtonVariant = tv({
  base: "keycap text-text inline-flex shrink-0 items-center justify-center gap-1.5 px-2.5 font-medium tracking-[0.08em] uppercase outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-35",
  variants: {
    design: {
      default: "hover:text-bright",
      // lit key: the legend glows in the cap colour
      accent: "text-accent hover:brightness-125",
      // latched key: the cap itself glows
      active: "![background:var(--accent)] text-ink shadow-[0_0_8px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
      // flat legend, no cap, for secondary actions on screens
      ghost: "!bg-none !shadow-none text-muted hover:text-bright"
    },
    size: {
      sm: "h-5 rounded-[7px] px-2 text-[9px]",
      md: "h-7 text-[10px]",
      icon: "h-7 w-7 px-0"
    }
  },
  defaultVariants: { design: "default", size: "md" }
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  design?: keyof typeof ButtonVariant.variants.design;
  size?: keyof typeof ButtonVariant.variants.size;
};

export const Button = ({ design, size, className, ...props }: ButtonProps) => (
  <button
    type="button"
    // the keyboard drives the deck, buttons must not keep focus
    onMouseDown={(event) => event.preventDefault()}
    className={cn(ButtonVariant({ design, size }), className)}
    {...props}
  />
);
