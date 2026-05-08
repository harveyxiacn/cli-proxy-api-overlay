import { cn } from "@/lib/utils"

interface SelectProps {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
  placeholder?: string
}

export function Select({ value, onChange, options, className, placeholder }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(
        "bg-[#0f1117] border border-[#2d3148] rounded-md text-[#e2e8f0]",
        "px-2.5 py-1.5 text-[0.83rem]",
        "focus:outline-none focus:border-[#6c63ff] cursor-pointer",
        className
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
