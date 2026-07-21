import type { ReactNode } from "react";

interface MediaCanvasProps {
  children: ReactNode;
  label?: string;
}

export function MediaCanvas({ children, label = "创作画布" }: MediaCanvasProps) {
  return (
    <section className="wb-canvas" aria-label={label}>
      {children}
    </section>
  );
}
