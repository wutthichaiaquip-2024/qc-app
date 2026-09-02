export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: string;
};

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const baseClass =
    "rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-full";

  if (field.type === "select") {
    return (
      <select
        value={value}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
        className={baseClass}
      >
        <option value="">—</option>
        {field.options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.type}
      step={field.step}
      required={field.required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={baseClass}
    />
  );
}
