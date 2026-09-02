import { forwardRef, type InputHTMLAttributes } from "react";

export const FileInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function FileInput({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        type="file"
        className={`text-sm text-foreground-muted rounded-md border border-border-strong bg-surface px-3 py-1.5 file:mr-3 file:rounded file:border-0 file:bg-brand file:text-brand-foreground file:px-2.5 file:py-1 file:text-xs file:font-medium file:cursor-pointer hover:file:brightness-110 ${className}`}
        {...props}
      />
    );
  },
);
