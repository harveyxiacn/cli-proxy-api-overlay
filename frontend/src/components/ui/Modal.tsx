import { useEffect, useRef, useState, useCallback } from "react"
import { X } from "lucide-react"

export interface ModalState {
  open: boolean
  title: string
  subtitle: string
  progress: number
  detail: string
  closeable: boolean
}

interface ModalProps extends ModalState {
  onClose: () => void
  children?: React.ReactNode
}

export function Modal({ open, title, subtitle, progress, detail, closeable, onClose, children }: ModalProps) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape" && closeable) onClose() }
    document.addEventListener("keydown", fn)
    return () => document.removeEventListener("keydown", fn)
  }, [closeable, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/55 z-[1000] flex items-center justify-center"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={e => { if (e.target === e.currentTarget && closeable) onClose() }}
    >
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-xl p-6 min-w-[360px] max-w-[560px] w-[92vw] shadow-2xl">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-bold text-base">{title}</h3>
          {closeable && (
            <button onClick={onClose} className="text-[#64748b] hover:text-[#e2e8f0] ml-4 transition-colors">
              <X size={16} />
            </button>
          )}
        </div>
        {subtitle && <p className="text-sm text-[#94a3b8] mb-3 min-h-[1.2em]">{subtitle}</p>}
        <div className="h-2 rounded bg-[#0f1117] overflow-hidden mb-2.5">
          <div
            className="h-full rounded bg-[#6c63ff] transition-all duration-400"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        {detail && <p className="text-[0.78rem] text-[#64748b] min-h-[1.1em] mb-1">{detail}</p>}
        {children}
      </div>
    </div>
  )
}

const initialState: ModalState = { open: false, title: "", subtitle: "", progress: 0, detail: "", closeable: false }

export function useProgressModal() {
  const [state, setState] = useState<ModalState>(initialState)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopAnimation = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const show = useCallback((title: string, subtitle = "") => {
    stopAnimation()
    setState({ open: true, title, subtitle, progress: 0, detail: "", closeable: false })
  }, [stopAnimation])

  const update = useCallback((progress: number, subtitle?: string, detail = "") => {
    setState(s => ({ ...s, progress, ...(subtitle != null ? { subtitle } : {}), ...(detail ? { detail } : {}) }))
  }, [])

  const finish = useCallback((subtitle = "", detail = "") => {
    stopAnimation()
    setState(s => ({ ...s, progress: 100, subtitle, detail, closeable: true }))
  }, [stopAnimation])

  const close = useCallback(() => setState(s => ({ ...s, open: false })), [])

  const animateTo = useCallback((max: number, intervalMs = 1500) => {
    stopAnimation()
    timerRef.current = setInterval(() => {
      setState(s => ({ ...s, progress: Math.min(max, s.progress + (max - s.progress) * 0.12 + 1) }))
    }, intervalMs)
  }, [stopAnimation])

  return { state, show, update, finish, close, animateTo, stopAnimation }
}
