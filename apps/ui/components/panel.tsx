import { HTMLAttributes, ReactNode } from "react";

import { cn } from "~/utils/classes.util";

type PanelProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
  // the body is a black glass screen set into the module
  screen?: boolean;
};

/** A module of the body: printed legend on top, keys or a screen below */
export const Panel = ({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  screen,
  ...props
}: PanelProps) => {
  return (
    <section
      className={cn("module flex min-h-0 min-w-0 flex-col p-1.5", className)}
      {...props}
    >
      {(title || actions) && (
        <header className="flex h-6 shrink-0 items-center gap-2 px-1.5 pb-1">
          {icon && <span className="text-dim">{icon}</span>}
          <span className="legend truncate">{title}</span>
          <span className="ml-auto flex items-center gap-1.5">{actions}</span>
        </header>
      )}
      <div
        className={cn(
          "relative min-h-0 flex-1",
          screen && "screen overflow-hidden",
          bodyClassName
        )}
      >
        {children}
      </div>
    </section>
  );
};
