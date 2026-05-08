import { Component, type ReactNode, type ErrorInfo } from "react"

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("React error boundary caught:", error, errorInfo)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 p-5 border border-red-500/40 bg-red-500/10 rounded-lg text-red-300">
          <h2 className="font-bold text-base mb-2">⚠ 页面渲染错误</h2>
          <pre className="text-[0.78rem] text-red-200 whitespace-pre-wrap break-all bg-black/30 p-2 rounded mb-3">
            {this.state.error.message}
            {this.state.error.stack && "\n\n" + this.state.error.stack.split("\n").slice(0, 6).join("\n")}
          </pre>
          <button
            onClick={this.reset}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-white text-[0.83rem] cursor-pointer"
          >
            重试
          </button>
          <button
            onClick={() => window.location.reload()}
            className="ml-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-white text-[0.83rem] cursor-pointer"
          >
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
