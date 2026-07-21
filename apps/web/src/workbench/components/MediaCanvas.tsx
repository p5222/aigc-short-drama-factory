import type { ReactNode } from "react";

interface MediaCanvasProps {
  children: ReactNode;
  label?: string;
}

export type MediaAspectRatio = "16:9" | "9:16" | "1:1";

interface MediaFrameProps {
  children: ReactNode;
  aspectRatio?: MediaAspectRatio;
  label?: string;
}

export function MediaCanvas({ children, label = "创作画布" }: MediaCanvasProps) {
  return (
    <section className="wb-canvas" aria-label={label}>
      {children}
    </section>
  );
}

export function MediaFrame({ children, aspectRatio = "16:9", label }: MediaFrameProps) {
  const ratioClass = aspectRatio === "9:16"
    ? " wb-media-frame--portrait"
    : aspectRatio === "1:1"
      ? " wb-media-frame--square"
      : "";

  return (
    <div className={`wb-media-frame${ratioClass}`} role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
