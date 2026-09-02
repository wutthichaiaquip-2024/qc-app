import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand ${className}`}
      {...props}
    />
  );
}
