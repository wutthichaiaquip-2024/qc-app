import type { HTMLAttributes } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-foreground-muted",
  brand: "bg-brand-muted text-brand",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  danger: "bg-danger-muted text-danger",
};

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    />
  );
}
