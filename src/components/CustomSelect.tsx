export interface SelectOption<T extends string | number> {
  label: string;
  value: T;
}

interface CustomSelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
}

export const CustomSelect = <T extends string | number>({
  id,
  value,
  options,
  onChange,
  placeholder,
}: CustomSelectProps<T>) => (
  <select
    id={id}
    aria-label={id ? undefined : placeholder}
    value={value}
    onChange={(event) => {
      const selected = options.find((option) => String(option.value) === event.currentTarget.value);
      if (selected) onChange(selected.value);
    }}
    className="w-full h-11 neu-pressed rounded-lg px-4 pr-9 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#F27D26]"
  >
    {placeholder && (
      <option value="" disabled>
        {placeholder}
      </option>
    )}
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);
