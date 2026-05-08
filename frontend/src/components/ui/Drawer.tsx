import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export function Drawer({ open, onClose, title, children, width = 480 }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    if (open) document.addEventListener("keydown", fn)
    return () => document.removeEventListener("keydown", fn)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[900] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        onClick={e => e.stopPropagation()}
        style={{ width }}
        className={cn(
          "absolute right-0 top-0 bottom-0 bg-[#1a1d27] border-l border-[#2d3148] shadow-2xl",
          "flex flex-col overflow-hidden"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d3148] sticky top-0 bg-[#1a1d27] z-10">
          <h3 className="text-sm font-bold truncate">{title}</h3>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0] transition-colors p-1 -m-1">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </aside>
    </div>
  )
}
