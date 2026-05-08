import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useConnection } from "@/stores/connection"
import { apiFetch, serverVersion } from "@/api/client"
import { explainRouting } from "@/api/queries"
import { Card, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Alert } from "@/components/ui/Alert"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import type { RoutingExplainResponse } from "@/api/types"

interface ProxyConfig   { proxy_url?: string }
interface RoutingConfig { strategy?: string  }
interface OpsConfig {
  debug: boolean
  loggingToFile: boolean
  usageStatisticsEnabled: boolean
  disableCooling: boolean
  authAutoRefreshWorkers: number
  requestRetry: number
  maxRetryCredentials: number
  maxRetryInterval: number
  logsMaxTotalSizeMB: number
  errorLogsMaxFiles: number
}

export function Settings() {
  const { config, connected } = useConnection()
  const toast = useToast()
  const qc = useQueryClient()
  const [proxyEdit, setProxyEdit] = useState<string | null>(null)

  const proxyQ = useQuery({
    queryKey: ["proxy-url", config.url, config.key],
    queryFn:  () => apiFetch<ProxyConfig>("GET", "/proxy-url", config),
    enabled:  connected,
  })

  const routingQ = useQuery({
    queryKey: ["routing-strategy", config.url, config.key],
    queryFn:  () => apiFetch<RoutingConfig>("GET", "/routing/strategy", config),
    enabled:  connected,
  })

  const opsQ = useQuery({
    queryKey: ["ops-config", config.url, config.key],
    queryFn: async (): Promise<OpsConfig> => {
      const [
        debug,
        loggingToFile,
        usageStatistics,
        disableCooling,
        workers,
        requestRetry,
        maxRetryCredentials,
        maxRetryInterval,
        logsMax,
        errorLogsMax,
      ] = await Promise.all([
        apiFetch<{ debug: boolean }>("GET", "/debug", config),
        apiFetch<{ "logging-to-file": boolean }>("GET", "/logging-to-file", config),
        apiFetch<{ "usage-statistics-enabled": boolean }>("GET", "/usage-statistics-enabled", config),
        apiFetch<{ "disable-cooling": boolean }>("GET", "/disable-cooling", config),
        apiFetch<{ "auth-auto-refresh-workers": number }>("GET", "/auth-auto-refresh-workers", config),
        apiFetch<{ "request-retry": number }>("GET", "/request-retry", config),
        apiFetch<{ "max-retry-credentials": number }>("GET", "/max-retry-credentials", config),
        apiFetch<{ "max-retry-interval": number }>("GET", "/max-retry-interval", config),
        apiFetch<{ "logs-max-total-size-mb": number }>("GET", "/logs-max-total-size-mb", config),
        apiFetch<{ "error-logs-max-files": number }>("GET", "/error-logs-max-files", config),
      ])
      return {
        debug: debug.debug,
        loggingToFile: loggingToFile["logging-to-file"],
        usageStatisticsEnabled: usageStatistics["usage-statistics-enabled"],
        disableCooling: disableCooling["disable-cooling"],
        authAutoRefreshWorkers: workers["auth-auto-refresh-workers"],
        requestRetry: requestRetry["request-retry"],
        maxRetryCredentials: maxRetryCredentials["max-retry-credentials"],
        maxRetryInterval: maxRetryInterval["max-retry-interval"],
        logsMaxTotalSizeMB: logsMax["logs-max-total-size-mb"],
        errorLogsMaxFiles: errorLogsMax["error-logs-max-files"],
      }
    },
    enabled: connected,
  })

  const proxyMut = useMutation({
    mutationFn: (url: string) =>
      url.trim()
        ? apiFetch("PUT",    "/proxy-url", config, { proxy_url: url })
        : apiFetch("DELETE", "/proxy-url", config),
    onSuccess: () => {
      toast.success("代理配置已更新")
      setProxyEdit(null)
      qc.invalidateQueries({ queryKey: ["proxy-url"] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const routingMut = useMutation({
    mutationFn: (strategy: string) => apiFetch("PUT", "/routing/strategy", config, { value: strategy }),
    onSuccess: () => {
      toast.success("路由策略已更新")
      qc.invalidateQueries({ queryKey: ["routing-strategy"] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const opsMut = useMutation({
    mutationFn: ({ path, value }: { path: string; value: boolean | number }) =>
      apiFetch("PUT", path, config, { value }),
    onSuccess: () => {
      toast.success("运行配置已更新")
      qc.invalidateQueries({ queryKey: ["ops-config"] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const updateNumber = (path: string, label: string, current: number) => {
    const raw = prompt(`设置 ${label}`, String(current))
    if (raw == null) return
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      toast.error("请输入有效数字")
      return
    }
    opsMut.mutate({ path, value: Math.trunc(value) })
  }

  if (!connected) return <Alert type="info">请先连接 CPA</Alert>

  return (
    <div>
      {/* Server info */}
      <Card>
        <CardTitle>服务器信息</CardTitle>
        <table className="text-[0.83rem]">
          <tbody>
            <tr>
              <td className="pr-4 py-1 text-[#64748b]">地址</td>
              <td className="text-[#94a3b8]">{config.url}</td>
            </tr>
            {serverVersion.version && (
              <>
                <tr>
                  <td className="pr-4 py-1 text-[#64748b]">版本</td>
                  <td className="text-[#94a3b8]">{serverVersion.version}</td>
                </tr>
                {serverVersion.commit && serverVersion.commit !== "none" && (
                  <tr>
                    <td className="pr-4 py-1 text-[#64748b]">Commit</td>
                    <td className="text-[#94a3b8] font-mono text-xs">{serverVersion.commit.slice(0, 12)}</td>
                  </tr>
                )}
                {serverVersion.buildDate && (
                  <tr>
                    <td className="pr-4 py-1 text-[#64748b]">构建时间</td>
                    <td className="text-[#94a3b8]">{serverVersion.buildDate}</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </Card>

      {/* Proxy URL */}
      <Card>
        <CardTitle>
          上游代理
          <Button variant="ghost" size="sm"
            onClick={() => setProxyEdit(proxyQ.data?.proxy_url ?? "")}>
            编辑
          </Button>
        </CardTitle>
        {proxyQ.isLoading && <Spinner />}
        {proxyEdit !== null ? (
          <div className="flex gap-2 items-center">
            <Input
              value={proxyEdit} onChange={e => setProxyEdit(e.target.value)}
              placeholder="http://127.0.0.1:7890  （留空=清除）"
              className="flex-1"
            />
            <Button variant="success" size="sm" onClick={() => proxyMut.mutate(proxyEdit)} disabled={proxyMut.isPending}>保存</Button>
            <Button variant="ghost"   size="sm" onClick={() => setProxyEdit(null)}>取消</Button>
          </div>
        ) : (
          <p className="text-[0.83rem] text-[#94a3b8]">
            {proxyQ.data?.proxy_url || <span className="text-[#64748b] italic">未配置（直连）</span>}
          </p>
        )}
      </Card>

      {/* Routing strategy */}
      <Card>
        <CardTitle>路由策略</CardTitle>
        {routingQ.isLoading && <Spinner />}
        {routingQ.data && (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[0.83rem] text-[#94a3b8]">
              当前：<b className="text-[#e2e8f0]">{routingQ.data.strategy}</b>
            </span>
            {["round-robin", "least-requests", "random"].map(s => (
              <Button
                key={s}
                variant={routingQ.data?.strategy === s ? "primary" : "ghost"}
                size="sm"
                onClick={() => routingMut.mutate(s)}
                disabled={routingMut.isPending}
              >
                {s}
              </Button>
            ))}
          </div>
        )}
        <p className="text-[0.74rem] text-[#64748b] mt-1.5">
          round-robin = 轮询；least-requests = 最少请求；random = 随机
        </p>
      </Card>

      {/* Runtime operations */}
      <Card>
        <CardTitle>
          运行配置
          <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["ops-config"] })}>
            刷新
          </Button>
        </CardTitle>
        {opsQ.isLoading && <Spinner />}
        {opsQ.isError && (
          <Alert type="error">加载运行配置失败：{opsQ.error instanceof Error ? opsQ.error.message : "未知错误"}</Alert>
        )}
        {opsQ.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <ToggleSetting
              label="Debug 模式"
              value={opsQ.data.debug}
              onToggle={() => opsMut.mutate({ path: "/debug", value: !opsQ.data?.debug })}
            />
            <ToggleSetting
              label="日志写文件"
              value={opsQ.data.loggingToFile}
              onToggle={() => opsMut.mutate({ path: "/logging-to-file", value: !opsQ.data?.loggingToFile })}
            />
            <ToggleSetting
              label="使用量统计"
              value={opsQ.data.usageStatisticsEnabled}
              onToggle={() => opsMut.mutate({ path: "/usage-statistics-enabled", value: !opsQ.data?.usageStatisticsEnabled })}
            />
            <ToggleSetting
              label="禁用冷却"
              value={opsQ.data.disableCooling}
              onToggle={() => opsMut.mutate({ path: "/disable-cooling", value: !opsQ.data?.disableCooling })}
            />
            <NumberSetting label="自动刷新 Worker" value={opsQ.data.authAutoRefreshWorkers} onEdit={() => updateNumber("/auth-auto-refresh-workers", "自动刷新 Worker", opsQ.data!.authAutoRefreshWorkers)} />
            <NumberSetting label="请求重试次数" value={opsQ.data.requestRetry} onEdit={() => updateNumber("/request-retry", "请求重试次数", opsQ.data!.requestRetry)} />
            <NumberSetting label="最大重试凭证数" value={opsQ.data.maxRetryCredentials} onEdit={() => updateNumber("/max-retry-credentials", "最大重试凭证数", opsQ.data!.maxRetryCredentials)} />
            <NumberSetting label="最大重试间隔(秒)" value={opsQ.data.maxRetryInterval} onEdit={() => updateNumber("/max-retry-interval", "最大重试间隔(秒)", opsQ.data!.maxRetryInterval)} />
            <NumberSetting label="日志总大小(MB)" value={opsQ.data.logsMaxTotalSizeMB} onEdit={() => updateNumber("/logs-max-total-size-mb", "日志总大小(MB)", opsQ.data!.logsMaxTotalSizeMB)} />
            <NumberSetting label="错误日志文件数" value={opsQ.data.errorLogsMaxFiles} onEdit={() => updateNumber("/error-logs-max-files", "错误日志文件数", opsQ.data!.errorLogsMaxFiles)} />
          </div>
        )}
      </Card>

      <RoutingExplainCard />
    </div>
  )
}

function RoutingExplainCard() {
  const { config, connected } = useConnection()
  const toast = useToast()
  const [provider, setProvider] = useState("")
  const [model, setModel] = useState("")
  const [result, setResult] = useState<RoutingExplainResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!connected) return
    setBusy(true)
    try {
      const r = await explainRouting(config, {
        provider: provider.trim() || undefined,
        model:    model.trim()    || undefined,
      })
      setResult(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardTitle>路由诊断（Routing Explain）</CardTitle>
      <Alert type="info" className="text-[0.78rem]">
        模拟一次请求的账号选择，查看哪个账号会被命中以及候选账号的评分。
        参数可选；留空表示不限。
      </Alert>
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <Input
          value={provider} onChange={e => setProvider(e.target.value)}
          placeholder="Provider（如 codex / claude / gemini）" className="w-[220px]"
        />
        <Input
          value={model} onChange={e => setModel(e.target.value)}
          placeholder="Model（如 gpt-4o）" className="w-[180px]"
        />
        <Button variant="primary" size="sm" onClick={run} disabled={busy}>
          {busy ? <><Spinner size={12} /> 计算中…</> : "🔎 诊断"}
        </Button>
        {result && (
          <Button variant="ghost" size="sm" onClick={() => setResult(null)}>清除结果</Button>
        )}
      </div>

      {result && (
        <div>
          <div className="mb-3 text-[0.85rem]">
            将选中：
            {result.selected
              ? <Badge variant="green" className="ml-2">{result.selected}</Badge>
              : <span className="ml-2 text-[#64748b]">无可用账号</span>
            }
          </div>
          {result.candidates.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.82rem] border-collapse">
                <thead>
                  <tr className="bg-[#22263a]">
                    <th className="text-left px-2 py-2 text-[#64748b] font-medium">账号</th>
                    <th className="text-left px-2 py-2 text-[#64748b] font-medium">评分</th>
                    <th className="text-left px-2 py-2 text-[#64748b] font-medium">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((c, i) => {
                    const isWinner = c.name === result.selected
                    const scoreColor = c.score >= 70 ? "text-green-400"
                      : c.score >= 40 ? "text-yellow-400"
                      : "text-red-400"
                    return (
                      <tr
                        key={i}
                        className={`border-t border-[#2d3148] ${isWinner ? "bg-green-500/5" : ""}`}
                      >
                        <td className="px-2 py-1.5 text-[#94a3b8]">
                          {isWinner && <span className="mr-1">⭐</span>}
                          {c.name}
                        </td>
                        <td className={`px-2 py-1.5 font-bold ${scoreColor}`}>{c.score}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1 flex-wrap">
                            {c.reasons.map((r, j) => (
                              <Badge
                                key={j}
                                variant={r === "healthy" ? "green" : r === "available" ? "blue" : "yellow"}
                                className="text-[0.68rem]"
                              >
                                {r}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function ToggleSetting({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-2">
      <span className="text-[0.83rem] text-[#94a3b8]">{label}</span>
      <Button variant={value ? "success" : "ghost"} size="sm" onClick={onToggle}>
        {value ? "开启" : "关闭"}
      </Button>
    </div>
  )
}

function NumberSetting({ label, value, onEdit }: { label: string; value: number; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#2d3148] bg-[#0f1117] px-3 py-2">
      <span className="text-[0.83rem] text-[#94a3b8]">{label}</span>
      <button className="text-sm text-[#e2e8f0] hover:text-[#6c63ff] font-mono" onClick={onEdit}>
        {value}
      </button>
    </div>
  )
}
