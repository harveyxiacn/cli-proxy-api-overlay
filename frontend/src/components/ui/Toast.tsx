import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { X, CheckCircle, AlertCircle, Info } from "lucide-react"

type ToastType = "success" | "error" | "info" | "warn"

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastOpts {
  duration?: number    // ms; default 4500
  action?: ToastAction // optional inline button
}

interface Toast {
  id: number
  type: ToastType
  message: string
  action?: ToastAction
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, opts?: ToastOpts) => number
  dismiss: (id: number) => void
}
const ToastContext = createContext<ToastContextValue>({ toast: () => 0, dismiss: () => {} })

const icons = { success: CheckCircle, error: AlertCircle, info: Info, warn: AlertCircle }
const colors = {
  success: "border-green-500/30 bg-green-500/10 text-green-300",
  error:   "border-red-500/30   bg-red-500/10   text-red-300",
  info:    "border-blue-500/30  bg-blue-500/10  text-blue-300",
  warn:    "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
}

const buttonColors = {
  success: "border-green-400/40 hover:bg-green-500/15 text-green-300",
  error:   "border-red-400/40   hover:bg-red-500/15   text-red-300",
  info:    "border-blue-400/40  hover:bg-blue-500/15  text-blue-300",
  warn:    "border-yellow-400/40 hover:bg-yellow-500/15 text-yellow-300",
}

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback(
    (id: number) => setToasts(t => t.filter(x => x.id !== id)),
    []
  )

  const toast = useCallback(
    (type: ToastType, message: string, opts: ToastOpts = {}): number => {
      const id = ++nextId
      setToasts(t => [...t, { id, type, message, action: opts.action }])
      const duration = opts.duration ?? (opts.action ? 8_000 : 4_500)
      if (duration > 0) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[2000] max-w-sm">
        {toasts.map(t => {
          const Icon = icons[t.type]
          return (
            <div key={t.id} className={cn(
              "flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm shadow-lg",
              "animate-in slide-in-from-right-4",
              colors[t.type]
            )}>
              <Icon size={15} className="shrink-0 mt-0.5" />
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id) }}
                  className={cn(
                    "px-2 py-0.5 rounded border text-[0.74rem] font-semibold transition-colors",
                    buttonColors[t.type]
                  )}
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                className="opacity-60 hover:opacity-100 ml-1 shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const { toast, dismiss } = useContext(ToastContext)
  return {
    success: (msg: string, opts?: ToastOpts) => toast("success", msg, opts),
    error:   (msg: string, opts?: ToastOpts) => toast("error",   msg, opts),
    info:    (msg: string, opts?: ToastOpts) => toast("info",    msg, opts),
    warn:    (msg: string, opts?: ToastOpts) => toast("warn",    msg, opts),
    dismiss,
  }
}
