import type { ReactNode } from "react";

export function Header({
  title = "Dashboard",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-card px-6">
      <h1 className="text-xl font-semibold tracking-tight text-card-foreground">
        {title}
      </h1>
      {children ? <div className="flex items-center gap-3">{children}</div> : null}
    </header>
  );
}
