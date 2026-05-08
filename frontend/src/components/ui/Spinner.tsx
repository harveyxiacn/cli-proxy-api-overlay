export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block rounded-full border-transparent border-t-current animate-spin ${className ?? ""}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.floor(size / 7)), borderStyle: "solid" }}
    />
  )
}
