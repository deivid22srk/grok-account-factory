'use client'

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"
import {
  Plus, RefreshCw, Trash2, Star, Copy, ExternalLink, Key, Clock,
  CheckCircle2, AlertCircle, Loader2, Zap, User, Activity, Download,
  Terminal, RotateCw, AlertTriangle,
} from "lucide-react"
import { OAuthClient, type AccountInfo } from "@/lib/account-factory/oauth-client"
import {
  listAccounts, saveAccount, removeAccount, setActive, getActiveId,
  refreshAccount, exportAccountAsGrokFormat, downloadAsFile, markLimited,
  markAvailable, rotateToNextAvailable, type StoredAccount,
} from "@/lib/account-factory/store-client"
import {
  log, logInfo, logSuccess, logWarn, logError, logDebug,
  getLogs, clearLogs, subscribeLogs, type LogEntry, type LogLevel,
} from "@/lib/account-factory/logger"

type TabKey = "accounts" | "add" | "logs"
type AddStatus = "idle" | "starting" | "awaiting_authorization" | "polling" | "saved" | "error"

interface AddState {
  status: AddStatus
  verificationUrl?: string
  userCode?: string
  account?: AccountInfo
  error?: string
  startedAt?: number
}

export default function Home() {
  const [tab, setTab] = useState<TabKey>("accounts")
  const [accounts, setAccounts] = useState<StoredAccount[]>([])
  const [activeId, setActiveId] = useState("")
  const [add, setAdd] = useState<AddState>({ status: "idle" })
  const [busy, setBusy] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<StoredAccount | null>(null)
  const { toast } = useToast()
  const stopPollRef = useRef<boolean>(false)

  const refreshAccounts = useCallback(() => {
    const accs = listAccounts()
    setAccounts(accs)
    setActiveId(getActiveId())
  }, [])

  useEffect(() => {
    refreshAccounts()
    logInfo("system", "Web UI inicializada", { accounts: listAccounts().length })
  }, [refreshAccounts])

  // Auto-refresh active account info every 30s (to update expiry/limited state)
  useEffect(() => {
    const t = setInterval(() => {
      rotateToNextAvailable() // auto-clear expired limits, rotate if current is limited
      refreshAccounts()
    }, 30_000)
    return () => clearInterval(t)
  }, [refreshAccounts])

  useEffect(() => {
    return () => {
      stopPollRef.current = true
    }
  }, [])

  const handleAddAccount = async () => {
    setTab("add")
    setAdd({ status: "starting", startedAt: Date.now() })
    setBusy(true)
    stopPollRef.current = false

    try {
      const oauth = new OAuthClient()
      logInfo("oauth", "Iniciando device-code flow em auth.x.ai")

      const start = await oauth.startDevice()
      if (stopPollRef.current) return
      setAdd({
        status: "awaiting_authorization",
        verificationUrl: start.verification_uri_complete,
        userCode: start.user_code,
        startedAt: Date.now(),
      })
      logSuccess("oauth", `Device code obtido: ${start.user_code}`, { url: start.verification_uri_complete })
      toast({ title: "Link pronto — abra para autorizar" })

      // Poll for token in background
      setAdd((s) => ({ ...s, status: "polling" }))
      oauth
        .pollDevice(start.device_code, start.interval, start.expires_in, (msg) => {
          logDebug("oauth", msg)
        })
        .then(async (tok) => {
          if (stopPollRef.current) return
          try {
            logInfo("oauth", "Token recebido, buscando userinfo…")
            const acc = await oauth.accountFromToken(tok)
            saveAccount(acc, true)
            setAdd((s) => ({ ...s, status: "saved", account: acc }))
            logSuccess("oauth", `Conta salva: ${acc.email || acc.id}`, { id: acc.id, email: acc.email })
            toast({ title: "Conta adicionada!", description: acc.email || acc.id.slice(0, 16) })
            refreshAccounts()
          } catch (e: any) {
            const msg = e.message || String(e)
            setAdd((s) => ({ ...s, status: "error", error: msg }))
            logError("oauth", `Erro ao salvar token: ${msg}`)
            toast({ title: "Erro ao salvar", description: msg, variant: "destructive" })
          } finally {
            setBusy(false)
          }
        })
        .catch((e) => {
          if (stopPollRef.current) return
          const msg = e.message || String(e)
          setAdd((s) => ({ ...s, status: "error", error: msg }))
          logError("oauth", `Polling falhou: ${msg}`)
          toast({ title: "OAuth falhou", description: msg, variant: "destructive" })
          setBusy(false)
        })
    } catch (e: any) {
      const msg = e.message || String(e)
      setAdd((s) => ({ ...s, status: "error", error: msg }))
      logError("oauth", `Erro ao iniciar: ${msg}`)
      toast({ title: "Erro ao iniciar", description: msg, variant: "destructive" })
      setBusy(false)
    }
  }

  const handleCancelAdd = () => {
    stopPollRef.current = true
    setAdd({ status: "idle" })
    setBusy(false)
    logWarn("oauth", "Criação de conta cancelada pelo usuário")
    setTab("accounts")
  }

  const handleActivate = (id: string) => {
    if (setActive(id)) {
      refreshAccounts()
      logInfo("store", `Conta ativada: ${id.slice(0, 16)}`)
      toast({ title: "Conta ativada" })
    }
  }

  const handleRefresh = async (id: string) => {
    setBusy(true)
    logInfo("store", `Renovando token da conta ${id.slice(0, 16)}…`)
    try {
      await refreshAccount(id)
      refreshAccounts()
      logSuccess("store", `Token renovado: ${id.slice(0, 16)}`)
      toast({ title: "Token renovado" })
    } catch (e: any) {
      logError("store", `Erro ao renovar: ${e.message}`)
      toast({ title: "Erro ao renovar", description: e.message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleMarkLimited = (id: string, reason: string) => {
    markLimited(id, reason, new Date(Date.now() + 5 * 60 * 1000)) // 5 min cooldown
    refreshAccounts()
    logWarn("store", `Conta marcada como limitada: ${id.slice(0, 16)}`, { reason })
    // Trigger auto-rotation
    const newId = rotateToNextAvailable()
    if (newId && newId !== id) {
      refreshAccounts()
      logInfo("store", `Auto-rotacionado para: ${newId.slice(0, 16)}`)
      toast({ title: "Conta limitada — rotacionado", description: `Nova ativa: ${newId.slice(0, 16)}` })
    } else {
      toast({ title: "Conta marcada como limitada" })
    }
  }

  const handleMarkAvailable = (id: string) => {
    markAvailable(id)
    refreshAccounts()
    logInfo("store", `Conta liberada: ${id.slice(0, 16)}`)
    toast({ title: "Conta liberada" })
  }

  const handleRotate = () => {
    const currentId = getActiveId()
    // Mark current as limited to force rotation
    if (currentId) {
      markLimited(currentId, "manual_rotation", new Date(Date.now() + 5 * 60 * 1000))
    }
    const newId = rotateToNextAvailable()
    refreshAccounts()
    if (newId) {
      logInfo("store", `Rotação manual: ${currentId?.slice(0, 16)} → ${newId.slice(0, 16)}`)
      toast({ title: "Rotacionado", description: `Nova ativa: ${newId.slice(0, 16)}` })
    } else {
      logWarn("store", "Rotação falhou — nenhuma conta disponível")
      toast({ title: "Sem contas disponíveis", variant: "destructive" })
    }
  }

  const handleConfirmRemove = () => {
    if (!removeTarget) return
    const id = removeTarget.id
    if (removeAccount(id)) {
      refreshAccounts()
      logWarn("store", `Conta removida: ${id.slice(0, 16)}`)
      toast({ title: "Conta removida" })
    }
    setRemoveTarget(null)
  }

  const handleExport = (acc: StoredAccount) => {
    const json = exportAccountAsGrokFormat(acc)
    downloadAsFile(`${acc.id}.json`, json)
    logInfo("store", `Conta exportada: ${acc.id}.json`)
    toast({ title: "Conta exportada", description: `${acc.id}.json` })
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: `${label} copiado` })
  }

  // Find the active account object (with full details)
  const activeAccount = accounts.find((a) => a.id === activeId)
  const limitedCount = accounts.filter((a) => a.limited && (!a.limited_until || new Date(a.limited_until).getTime() > Date.now())).length
  const expiredCount = accounts.filter((a) => a.expires_at && new Date(a.expires_at).getTime() < Date.now()).length

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Grok Account Factory</h1>
              <p className="text-xs text-zinc-400">Gestão de contas para grok-proxy-cli</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshAccounts}>
              <RefreshCw className="size-4 mr-2" />
              Atualizar
            </Button>
            <Button size="sm" onClick={handleAddAccount} disabled={busy}>
              <Plus className="size-4 mr-2" />
              Adicionar conta
            </Button>
          </div>
        </div>
      </header>

      {/* Active account banner (sticky below header) */}
      {activeAccount && (
        <div className="border-b border-zinc-800/80 bg-gradient-to-r from-emerald-950/60 to-cyan-950/40">
          <div className="container mx-auto px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-9 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Star className="size-4 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-emerald-400/80 font-semibold uppercase tracking-wide">Conta ativa</span>
                    {activeAccount.limited && (
                      <Badge variant="destructive" className="text-[10px] py-0">LIMITADA</Badge>
                    )}
                  </div>
                  <div className="text-sm font-medium text-zinc-100 truncate">
                    {activeAccount.email || activeAccount.label}
                  </div>
                  <div className="text-xs text-zinc-400 font-mono truncate">
                    {activeAccount.id.slice(0, 24)}…
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRotate}
                  disabled={accounts.length < 2}
                  className="border-zinc-700 hover:bg-zinc-800"
                  title="Pular para a próxima conta disponível"
                >
                  <RotateCw className="size-3.5 mr-1.5" />
                  Rotacionar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRefresh(activeAccount.id)}
                  disabled={busy}
                  className="border-zinc-700 hover:bg-zinc-800"
                >
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Renovar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-3 bg-zinc-900/60 border border-zinc-800">
            <TabsTrigger value="accounts" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
              <User className="size-4 mr-2" /> Contas
              <span className="ml-1 text-xs text-zinc-500">({accounts.length})</span>
            </TabsTrigger>
            <TabsTrigger value="add" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
              <Plus className="size-4 mr-2" /> Adicionar
            </TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
              <Terminal className="size-4 mr-2" /> Logs
            </TabsTrigger>
          </TabsList>

          {/* ===== Accounts tab ===== */}
          <TabsContent value="accounts" className="mt-6 space-y-4">
            {/* Summary cards */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="bg-zinc-900/60 border-zinc-800">
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold text-emerald-400">{accounts.length}</div>
                      <div className="text-xs text-zinc-500">Total de contas</div>
                    </div>
                    <User className="size-8 text-zinc-700" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-zinc-900/60 border-zinc-800">
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold text-amber-400">{limitedCount}</div>
                      <div className="text-xs text-zinc-500">Limitadas</div>
                    </div>
                    <AlertTriangle className="size-8 text-zinc-700" />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-zinc-900/60 border-zinc-800">
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold text-red-400">{expiredCount}</div>
                      <div className="text-xs text-zinc-500">Expiradas</div>
                    </div>
                    <Clock className="size-8 text-zinc-700" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Accounts table */}
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-5 text-emerald-400" />
                  Contas
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  Clique em <Star className="inline size-3" /> para ativar uma conta. Use <Download className="inline size-3" /> para exportar no formato do grok-proxy-cli (<code className="text-zinc-300 bg-zinc-800 px-1 rounded text-xs">~/.local/share/GrokDesktop/accounts/&lt;id&gt;.json</code>).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {accounts.length === 0 ? (
                  <EmptyState onAdd={handleAddAccount} />
                ) : (
                  <ScrollArea className="max-h-[60vh] rounded-md border border-zinc-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-zinc-900 hover:bg-zinc-900 border-zinc-800">
                          <TableHead className="text-zinc-400 w-8"></TableHead>
                          <TableHead className="text-zinc-400">Email / Label</TableHead>
                          <TableHead className="text-zinc-400">ID</TableHead>
                          <TableHead className="text-zinc-400">Status</TableHead>
                          <TableHead className="text-zinc-400">Expira</TableHead>
                          <TableHead className="text-zinc-400 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {accounts.map((a) => {
                          const expired = a.expires_at ? new Date(a.expires_at).getTime() < Date.now() : false
                          const isActive = a.id === activeId
                          const isLimited = a.limited && (!a.limited_until || new Date(a.limited_until).getTime() > Date.now())
                          return (
                            <TableRow
                              key={a.id}
                              className={`border-zinc-800 ${isActive ? "bg-emerald-950/20" : "hover:bg-zinc-800/40"}`}
                            >
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleActivate(a.id)}
                                  disabled={isActive}
                                  title={isActive ? "Já é a ativa" : "Ativar"}
                                  className="hover:bg-emerald-500/20 hover:text-emerald-300 p-1"
                                >
                                  <Star className={`size-4 ${isActive ? "fill-emerald-400 text-emerald-400" : ""}`} />
                                </Button>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">{a.email || "—"}</span>
                                  <span className="text-xs text-zinc-500">{a.label}</span>
                                  {a.last_used && (
                                    <span className="text-[10px] text-zinc-600">
                                      usado: {new Date(a.last_used).toLocaleString("pt-BR")}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-zinc-300">
                                {a.id.slice(0, 16)}…
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {isActive && (
                                    <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white">
                                      <Star className="size-3 mr-1 fill-white" /> Ativa
                                    </Badge>
                                  )}
                                  {isLimited ? (
                                    <Badge variant="destructive" title={a.limited_reason}>
                                      <AlertTriangle className="size-3 mr-1" />
                                      {a.limited_reason || "Limitada"}
                                    </Badge>
                                  ) : expired ? (
                                    <Badge variant="destructive">Expirada</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">Válida</Badge>
                                  )}
                                  {a.refresh_token && (
                                    <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                                      <Key className="size-3 mr-1" /> Refresh
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-zinc-400">
                                {a.expires_at ? new Date(a.expires_at).toLocaleString("pt-BR") : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-0.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleRefresh(a.id)}
                                    title="Renovar token"
                                    className="hover:bg-cyan-500/20 hover:text-cyan-300 p-1.5"
                                  >
                                    <RefreshCw className="size-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleExport(a)}
                                    title="Exportar JSON"
                                    className="hover:bg-amber-500/20 hover:text-amber-300 p-1.5"
                                  >
                                    <Download className="size-4" />
                                  </Button>
                                  {isLimited ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleMarkAvailable(a.id)}
                                      title="Marcar como disponível"
                                      className="hover:bg-emerald-500/20 hover:text-emerald-300 p-1.5"
                                    >
                                      <CheckCircle2 className="size-4" />
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleMarkLimited(a.id, "manual")}
                                      title="Marcar como limitada (força rotação)"
                                      className="hover:bg-amber-500/20 hover:text-amber-300 p-1.5"
                                    >
                                      <AlertTriangle className="size-4" />
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setRemoveTarget(a)}
                                    title="Remover conta"
                                    className="hover:bg-red-500/20 hover:text-red-300 p-1.5"
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Add account tab ===== */}
          <TabsContent value="add" className="mt-6">
            {add.status === "idle" ? (
              <Card className="bg-zinc-900/60 border-zinc-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="size-5 text-emerald-400" />
                    Adicionar nova conta
                  </CardTitle>
                  <CardDescription className="text-zinc-400">
                    Gera um link de autorização no xAI. Você abre, faz login com sua conta xAI
                    existente (ou cria uma nova), e autoriza o <code className="text-zinc-300 bg-zinc-800 px-1 rounded text-xs">grok-proxy-cli</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-7 rounded-full bg-emerald-500/20 text-emerald-300 text-sm font-bold flex items-center justify-center">1</div>
                        <h4 className="text-sm font-medium text-zinc-200">Gerar link</h4>
                      </div>
                      <p className="text-xs text-zinc-500">Iniciamos o OAuth device flow em auth.x.ai e te damos um link + código.</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-7 rounded-full bg-cyan-500/20 text-cyan-300 text-sm font-bold flex items-center justify-center">2</div>
                        <h4 className="text-sm font-medium text-zinc-200">Você autoriza</h4>
                      </div>
                      <p className="text-xs text-zinc-500">Abre o link, faz login no xAI (ou cria conta), clica em "Allow".</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-7 rounded-full bg-amber-500/20 text-amber-300 text-sm font-bold flex items-center justify-center">3</div>
                        <h4 className="text-sm font-medium text-zinc-200">Token salvo</h4>
                      </div>
                      <p className="text-xs text-zinc-500">Detectamos o token automaticamente e salvamos no navegador.</p>
                    </div>
                  </div>
                  <Button onClick={handleAddAccount} size="lg" className="w-full bg-emerald-600 hover:bg-emerald-500">
                    <Zap className="size-4 mr-2" />
                    Gerar link de autorização
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <AddAccountPanel
                state={add}
                onCopy={copyToClipboard}
                onCancel={handleCancelAdd}
              />
            )}
          </TabsContent>

          {/* ===== Logs tab ===== */}
          <TabsContent value="logs" className="mt-6">
            <LogsPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-zinc-800/80 bg-zinc-950/80 py-3 mt-auto">
        <div className="container mx-auto px-4 text-center text-xs text-zinc-500">
          grok-proxy-cli account_factory · não afiliado à xAI · use por sua conta e risco
        </div>
      </footer>
      <Toaster />

      {/* Remove confirm dialog */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Remover conta?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {removeTarget && (
                <>
                  Você vai remover a conta <b className="text-zinc-200">{removeTarget.email || removeTarget.label}</b>
                  {" "}(<code className="text-zinc-300">{removeTarget.id.slice(0, 16)}…</code>) do navegador.
                  <br /><br />
                  <span className="text-amber-400">⚠️ Isso não remove a conta do xAI — apenas apaga o token salvo localmente.</span>
                  {" "}Se quiser usar a conta de novo, basta adicionar novamente.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-red-600 hover:bg-red-500"
            >
              <Trash2 className="size-4 mr-2" /> Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="size-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
        <User className="size-8 text-zinc-500" />
      </div>
      <h3 className="text-lg font-semibold text-zinc-300 mb-1">Nenhuma conta configurada</h3>
      <p className="text-sm text-zinc-500 mb-4 max-w-md">
        Adicione sua primeira conta xAI. Vamos gerar um link de autorização —
        você abre, faz login no xAI, e nós salvamos o token.
      </p>
      <Button onClick={onAdd} className="bg-emerald-600 hover:bg-emerald-500">
        <Plus className="size-4 mr-2" /> Adicionar primeira conta
      </Button>
    </div>
  )
}

function AddAccountPanel({
  state,
  onCopy,
  onCancel,
}: {
  state: AddState
  onCopy: (text: string, label: string) => void
  onCancel: () => void
}) {
  const meta = getAddStatusMeta(state.status)
  const isDone = state.status === "saved"
  const isError = state.status === "error"
  const isWaiting = state.status === "awaiting_authorization" || state.status === "polling" || state.status === "starting"
  const elapsed = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <Card className={`${meta.bg} ${meta.border}`}>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className={`${meta.iconBg} ${meta.iconColor} size-10 rounded-full flex items-center justify-center flex-shrink-0`}>
              {meta.icon}
            </div>
            <div className="flex-1">
              <h3 className={`font-semibold ${meta.titleColor}`}>{meta.title}</h3>
              <p className={`text-sm ${meta.descColor}`}>{meta.desc}</p>
              {isWaiting && (
                <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400">
                  <Loader2 className="size-3 animate-spin" />
                  <span>Polling a cada 5s</span>
                  <span className="text-zinc-600">·</span>
                  <span>{elapsed}s decorridos</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verification URL */}
      {isWaiting && state.verificationUrl && (
        <Card className="bg-zinc-900/60 border-zinc-800 border-emerald-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="size-6 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center">1</span>
              <ExternalLink className="size-4 text-emerald-400" />
              Abra este link no seu navegador
            </CardTitle>
            <CardDescription>
              Página oficial do xAI para autorizar o <code className="text-emerald-300 bg-zinc-800 px-1 rounded">grok-proxy-cli</code>.
              Faça login (ou crie conta) e clique em "Allow".
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                readOnly
                value={state.verificationUrl}
                className="font-mono text-xs bg-zinc-950 border-zinc-800"
              />
              <Button
                variant="outline"
                onClick={() => onCopy(state.verificationUrl!, "URL")}
                className="border-zinc-700"
              >
                <Copy className="size-4" />
              </Button>
              <Button asChild className="bg-emerald-600 hover:bg-emerald-500">
                <a href={state.verificationUrl} target="_blank" rel="noreferrer">
                  Abrir <ExternalLink className="size-4 ml-1" />
                </a>
              </Button>
            </div>
            <div className="rounded-md bg-zinc-950/60 border border-zinc-800 p-3 text-xs">
              <span className="text-zinc-500">user_code (caso peça):</span>{" "}
              <code className="text-emerald-300 font-bold tracking-wider">{state.userCode}</code>
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 p-1 h-auto"
                onClick={() => onCopy(state.userCode || "", "user_code")}
              >
                <Copy className="size-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success view */}
      {isDone && state.account && (
        <Card className="bg-emerald-950/40 border-emerald-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="size-5" /> Conta adicionada e ativada!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1 text-zinc-400">ID</div>
              <div className="col-span-2 font-mono text-xs">{state.account.id}</div>
              <div className="col-span-1 text-zinc-400">Email</div>
              <div className="col-span-2">{state.account.email || "—"}</div>
              <div className="col-span-1 text-zinc-400">Team</div>
              <div className="col-span-2 font-mono text-xs">{state.account.team_id || "—"}</div>
              <div className="col-span-1 text-zinc-400">Expira</div>
              <div className="col-span-2">{new Date(state.account.expires_at).toLocaleString("pt-BR")}</div>
            </div>
            <div className="pt-3 border-t border-emerald-900/40 text-xs text-emerald-400/80">
              ✅ A conta foi salva e marcada como ativa. Volte para a aba <b>Contas</b> para exportá-la
              no formato do grok-proxy-cli.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error view */}
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription className="font-mono text-xs break-all">{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} className="border-zinc-700">
          {isDone ? "Voltar" : "Cancelar"}
        </Button>
      </div>
    </div>
  )
}

function getAddStatusMeta(status: AddStatus) {
  switch (status) {
    case "starting":
      return {
        title: "Iniciando…",
        desc: "Solicitando device code em auth.x.ai",
        icon: <Loader2 className="size-5 animate-spin" />,
        bg: "bg-cyan-950/40 border-cyan-900/60",
        border: "border-cyan-900/60",
        iconBg: "bg-cyan-500/20",
        iconColor: "text-cyan-300",
        titleColor: "text-cyan-200",
        descColor: "text-cyan-400/80",
      }
    case "awaiting_authorization":
      return {
        title: "Aguardando autorização",
        desc: "Abra o link abaixo e autorize o grok-proxy-cli no xAI",
        icon: <Clock className="size-5" />,
        bg: "bg-amber-950/40 border-amber-900/60",
        border: "border-amber-900/60",
        iconBg: "bg-amber-500/20",
        iconColor: "text-amber-300",
        titleColor: "text-amber-200",
        descColor: "text-amber-400/80",
      }
    case "polling":
      return {
        title: "Aguardando autorização",
        desc: "Polling ativo — vamos detectar o token assim que você autorizar",
        icon: <Loader2 className="size-5 animate-spin" />,
        bg: "bg-amber-950/40 border-amber-900/60",
        border: "border-amber-900/60",
        iconBg: "bg-amber-500/20",
        iconColor: "text-amber-300",
        titleColor: "text-amber-200",
        descColor: "text-amber-400/80",
      }
    case "saved":
      return {
        title: "Conta adicionada!",
        desc: "Token salvo no navegador e marcado como ativo",
        icon: <CheckCircle2 className="size-5" />,
        bg: "bg-emerald-950/40 border-emerald-900/60",
        border: "border-emerald-900/60",
        iconBg: "bg-emerald-500/20",
        iconColor: "text-emerald-300",
        titleColor: "text-emerald-200",
        descColor: "text-emerald-400/80",
      }
    case "error":
      return {
        title: "Falha",
        desc: "Veja detalhes abaixo",
        icon: <AlertCircle className="size-5" />,
        bg: "bg-red-950/40 border-red-900/60",
        border: "border-red-900/60",
        iconBg: "bg-red-500/20",
        iconColor: "text-red-300",
        titleColor: "text-red-200",
        descColor: "text-red-400/80",
      }
    default:
      return {
        title: "",
        desc: "",
        icon: <Loader2 className="size-5" />,
        bg: "",
        border: "",
        iconBg: "",
        iconColor: "",
        titleColor: "",
        descColor: "",
      }
  }
}

// ============================================================
//  Logs Panel
// ============================================================
function LogsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>(() => getLogs().slice().reverse())
  const [filterLevel, setFilterLevel] = useState<LogLevel | "all">("all")
  const [filterSource, setFilterSource] = useState<string>("all")
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    setEntries(getLogs().slice().reverse()) // newest first
  }, [])

  useEffect(() => {
    const unsub = subscribeLogs(refresh)
    return () => { unsub() }
  }, [refresh])

  // Auto-scroll to top when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [entries, autoScroll])

  const filtered = entries.filter((e) => {
    if (filterLevel !== "all" && e.level !== filterLevel) return false
    if (filterSource !== "all" && e.source !== filterSource) return false
    return true
  })

  const sources = Array.from(new Set(entries.map((e) => e.source)))

  return (
    <Card className="bg-zinc-900/60 border-zinc-800">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-5 text-emerald-400" />
              Logs
              <Badge variant="outline" className="border-zinc-700 text-zinc-400 ml-2">
                {filtered.length} {filtered.length === 1 ? "entrada" : "entradas"}
              </Badge>
            </CardTitle>
            <CardDescription className="text-zinc-400 mt-1">
              Histórico de ações da Web UI: OAuth, salvamento de contas, rotações, erros.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterLevel} onValueChange={(v) => setFilterLevel(v as any)}>
              <SelectTrigger className="w-32 h-8 bg-zinc-950 border-zinc-800 text-xs">
                <SelectValue placeholder="Nível" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="w-32 h-8 bg-zinc-950 border-zinc-800 text-xs">
                <SelectValue placeholder="Fonte" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="all">Todas</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoScroll(!autoScroll)}
              className={`h-8 ${autoScroll ? "border-emerald-700 text-emerald-300" : "border-zinc-700"}`}
              title="Auto-scroll para o topo"
            >
              <RefreshCw className={`size-3 mr-1 ${autoScroll ? "animate-spin" : ""}`} />
              Auto
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("Limpar todos os logs?")) {
                  clearLogs()
                  refresh()
                }
              }}
              className="h-8 border-red-900/50 text-red-300 hover:bg-red-950/40"
            >
              <Trash2 className="size-3 mr-1" />
              Limpar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Terminal className="size-8 text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500">
              {entries.length === 0
                ? "Nenhum log ainda. As ações aparecem aqui em tempo real."
                : "Nenhum log corresponde aos filtros."}
            </p>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-[60vh] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 font-mono text-xs"
          >
            <div className="divide-y divide-zinc-900">
              {filtered.map((e) => (
                <LogLine key={e.id} entry={e} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const meta = getLogMeta(entry.level)
  const time = new Date(entry.ts).toLocaleTimeString("pt-BR", { hour12: false })
  const date = new Date(entry.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })

  return (
    <div className={`flex items-start gap-3 px-3 py-2 ${meta.bg}`}>
      <span className="text-zinc-600 shrink-0">{date} {time}</span>
      <span className={`shrink-0 font-bold ${meta.color}`}>
        [{entry.level.toUpperCase().padEnd(5)}]
      </span>
      <span className="shrink-0 text-zinc-500">
        [{entry.source}]
      </span>
      <span className="text-zinc-200 break-all flex-1">
        {entry.msg}
        {entry.meta && Object.keys(entry.meta).length > 0 && (
          <span className="text-zinc-500 ml-2">
            {" "}{JSON.stringify(entry.meta)}
          </span>
        )}
      </span>
    </div>
  )
}

function getLogMeta(level: LogLevel) {
  switch (level) {
    case "success":
      return { color: "text-emerald-400", bg: "hover:bg-emerald-950/20" }
    case "info":
      return { color: "text-cyan-400", bg: "hover:bg-cyan-950/20" }
    case "warn":
      return { color: "text-amber-400", bg: "hover:bg-amber-950/20" }
    case "error":
      return { color: "text-red-400", bg: "hover:bg-red-950/20" }
    case "debug":
      return { color: "text-zinc-500", bg: "hover:bg-zinc-900" }
  }
}
