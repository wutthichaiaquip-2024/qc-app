import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand text-brand-foreground hover:brightness-110 disabled:opacity-50",
  secondary:
    "bg-surface border border-border-strong text-foreground hover:bg-surface-muted disabled:opacity-50",
  ghost: "text-foreground hover:bg-surface-muted disabled:opacity-50",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-50",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
