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
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"
import {
  Plus, RefreshCw, Trash2, Star, Copy, ExternalLink, Key, Mail, Lock, Clock,
  CheckCircle2, AlertCircle, Loader2, Zap, User, ZapIcon, Activity, Eye, EyeOff
} from "lucide-react"

interface AccountRow {
  id: string
  label: string
  email: string
  team_id: string
  expires_at: string
  expired: boolean
  active: boolean
  has_refresh_token: boolean
  created_at: string
  updated_at: string
}

interface JobRow {
  id: string
  status: "creating_email" | "awaiting_authorization" | "polling" | "saved" | "error"
  createdAt: number
  updatedAt: number
  email?: string
  password?: string
  verificationUrl?: string
  userCode?: string
  account?: any
  error?: string
}

type TabKey = "accounts" | "create"

export default function Home() {
  const [tab, setTab] = useState<TabKey>("accounts")
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [dataDir, setDataDir] = useState("")
  const { toast } = useToast()

  // Active job (when creating)
  const [activeJob, setActiveJob] = useState<JobRow | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const refreshAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const r = await fetch("/api/accounts/list")
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setAccounts(data.accounts || [])
      setDataDir(data.data_dir || "")
    } catch (e: any) {
      toast({ title: "Erro ao carregar contas", description: e.message, variant: "destructive" })
    } finally {
      setLoadingAccounts(false)
    }
  }, [toast])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  // Poll active job
  useEffect(() => {
    if (!activeJob) return
    if (activeJob.status === "saved" || activeJob.status === "error") return
    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${activeJob.id}`)
        const data = await r.json()
        if (data.job) {
          setActiveJob(data.job)
          if (data.job.status === "saved") {
            toast({ title: "Conta criada!", description: `Email: ${data.job.account?.email || data.job.email}` })
            refreshAccounts()
          } else if (data.job.status === "error") {
            toast({ title: "Erro na criação", description: data.job.error, variant: "destructive" })
          }
        }
      } catch {}
    }
    pollRef.current = setInterval(poll, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [activeJob, toast, refreshAccounts])

  const handleCreate = async () => {
    setTab("create")
    setActiveJob(null)
    try {
      const r = await fetch("/api/accounts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expires_in_sec: 1800 }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setActiveJob(data.job)
      toast({ title: "Sessão iniciada", description: "Aguardando autorização no xAI…" })
    } catch (e: any) {
      toast({ title: "Erro ao iniciar criação", description: e.message, variant: "destructive" })
    }
  }

  const handleCancelJob = () => {
    setActiveJob(null)
    setTab("accounts")
  }

  const handleActivate = async (id: string) => {
    try {
      const r = await fetch(`/api/accounts/${id}/activate`, { method: "POST" })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      toast({ title: "Conta ativada", description: id.slice(0, 16) + "…" })
      refreshAccounts()
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" })
    }
  }

  const handleRefresh = async (id: string) => {
    try {
      const r = await fetch(`/api/accounts/${id}/refresh`, { method: "POST" })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      toast({ title: "Token renovado", description: id.slice(0, 16) + "…" })
      refreshAccounts()
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`Remover conta ${id.slice(0, 16)}…?`)) return
    try {
      const r = await fetch(`/api/accounts/${id}`, { method: "DELETE" })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      toast({ title: "Conta removida" })
      refreshAccounts()
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" })
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: `${label} copiado`, description: text.slice(0, 60) + (text.length > 60 ? "…" : "") })
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <ZapIcon className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Grok Account Factory</h1>
              <p className="text-xs text-zinc-400">Criação e gestão de contas para grok-proxy-cli</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshAccounts} disabled={loadingAccounts}>
              <RefreshCw className={`size-4 mr-2 ${loadingAccounts ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" onClick={handleCreate}>
              <Plus className="size-4 mr-2" />
              Nova conta
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2 bg-zinc-900/60 border border-zinc-800">
            <TabsTrigger value="accounts" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
              <User className="size-4 mr-2" /> Contas
            </TabsTrigger>
            <TabsTrigger value="create" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
              <Plus className="size-4 mr-2" /> Criar conta
            </TabsTrigger>
          </TabsList>

          {/* Accounts tab */}
          <TabsContent value="accounts" className="mt-6">
            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-5 text-emerald-400" />
                  Contas existentes
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  Lidas do store do grok-proxy-cli:{" "}
                  <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-xs">{dataDir || "—"}</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingAccounts ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full bg-zinc-800" />)}
                  </div>
                ) : accounts.length === 0 ? (
                  <EmptyState onCreate={handleCreate} />
                ) : (
                  <ScrollArea className="max-h-[60vh] rounded-md border border-zinc-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-zinc-900 hover:bg-zinc-900 border-zinc-800">
                          <TableHead className="text-zinc-400">ID</TableHead>
                          <TableHead className="text-zinc-400">Email / Label</TableHead>
                          <TableHead className="text-zinc-400">Expira</TableHead>
                          <TableHead className="text-zinc-400">Status</TableHead>
                          <TableHead className="text-zinc-400 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {accounts.map((a) => (
                          <TableRow key={a.id} className="border-zinc-800 hover:bg-zinc-800/40">
                            <TableCell className="font-mono text-xs text-zinc-300">
                              {a.id.slice(0, 16)}…
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm">{a.email || "—"}</span>
                                <span className="text-xs text-zinc-500">{a.label}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-zinc-400">
                              {a.expires_at ? new Date(a.expires_at).toLocaleString("pt-BR") : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {a.active && (
                                  <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white">
                                    <Star className="size-3 mr-1" /> Ativa
                                  </Badge>
                                )}
                                {a.expired ? (
                                  <Badge variant="destructive">Expirada</Badge>
                                ) : (
                                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">Válida</Badge>
                                )}
                                {a.has_refresh_token && (
                                  <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                                    <Key className="size-3 mr-1" /> Refresh
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleActivate(a.id)}
                                  disabled={a.active}
                                  title="Ativar"
                                  className="hover:bg-emerald-500/20 hover:text-emerald-300"
                                >
                                  <Star className="size-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRefresh(a.id)}
                                  title="Renovar token"
                                  className="hover:bg-cyan-500/20 hover:text-cyan-300"
                                >
                                  <RefreshCw className="size-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDelete(a.id)}
                                  title="Remover"
                                  className="hover:bg-red-500/20 hover:text-red-300"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Create tab */}
          <TabsContent value="create" className="mt-6">
            {!activeJob ? (
              <Card className="bg-zinc-900/60 border-zinc-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="size-5 text-emerald-400" />
                    Criar nova conta
                  </CardTitle>
                  <CardDescription className="text-zinc-400">
                    Inicia o fluxo: email temporário (mail.tm) + OAuth device-code (auth.x.ai).
                    Você verá um link e credenciais para autorizar a conta no xAI.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FlowSteps />
                  <Button onClick={handleCreate} size="lg" className="w-full bg-emerald-600 hover:bg-emerald-500">
                    <Zap className="size-4 mr-2" />
                    Iniciar criação de conta
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <CreateJobPanel
                job={activeJob}
                showPassword={showPassword}
                onTogglePassword={() => setShowPassword(!showPassword)}
                onCopy={copyToClipboard}
                onCancel={handleCancelJob}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-zinc-800/80 bg-zinc-950/80 py-3 mt-auto">
        <div className="container mx-auto px-4 text-center text-xs text-zinc-500">
          grok-proxy-cli account_factory · não afiliado à xAI · use por sua conta e risco
        </div>
      </footer>
      <Toaster />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="size-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
        <User className="size-8 text-zinc-500" />
      </div>
      <h3 className="text-lg font-semibold text-zinc-300 mb-1">Nenhuma conta configurada</h3>
      <p className="text-sm text-zinc-500 mb-4 max-w-md">
        Clique no botão abaixo para iniciar a criação automática de uma conta xAI.
        Você vai receber um email temporário e um link de autorização.
      </p>
      <Button onClick={onCreate} className="bg-emerald-600 hover:bg-emerald-500">
        <Plus className="size-4 mr-2" /> Criar primeira conta
      </Button>
    </div>
  )
}

function FlowSteps() {
  const steps = [
    { n: 1, title: "Email temporário", desc: "Criamos um endereço @mail.tm para receber o código de verificação" },
    { n: 2, title: "OAuth device flow", desc: "Iniciamos o fluxo em auth.x.ai e obtemos um user_code" },
    { n: 3, title: "Você autoriza", desc: "Abrimos um link; você entra com o email temporário e autoriza o grok-proxy-cli" },
    { n: 4, title: "Token salvo", desc: "Recebemos o access_token + refresh_token e gravamos no store" },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s) => (
        <div key={s.n} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="size-6 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center">
              {s.n}
            </div>
            <h4 className="text-sm font-medium text-zinc-200">{s.title}</h4>
          </div>
          <p className="text-xs text-zinc-500">{s.desc}</p>
        </div>
      ))}
    </div>
  )
}

function CreateJobPanel({
  job,
  showPassword,
  onTogglePassword,
  onCopy,
  onCancel,
}: {
  job: JobRow
  showPassword: boolean
  onTogglePassword: () => void
  onCopy: (text: string, label: string) => void
  onCancel: () => void
}) {
  const statusMeta = getStatusMeta(job.status)
  const isDone = job.status === "saved"
  const isError = job.status === "error"
  const isWaiting = job.status === "awaiting_authorization" || job.status === "polling"

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <Card className={`${statusMeta.bg} ${statusMeta.border}`}>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className={`${statusMeta.iconBg} ${statusMeta.iconColor} size-10 rounded-full flex items-center justify-center flex-shrink-0`}>
              {statusMeta.icon}
            </div>
            <div className="flex-1">
              <h3 className={`font-semibold ${statusMeta.titleColor}`}>{statusMeta.title}</h3>
              <p className={`text-sm ${statusMeta.descColor}`}>{statusMeta.desc}</p>
              {isWaiting && (
                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="size-3 animate-spin" />
                  Polling do OAuth a cada 5s…
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Credentials + URL */}
      {isWaiting && job.verificationUrl && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Verification URL */}
          <Card className="bg-zinc-900/60 border-zinc-800 md:col-span-2 border-emerald-900/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ExternalLink className="size-4 text-emerald-400" />
                Passo 1 — Abra este link e autorize
              </CardTitle>
              <CardDescription>
                Use o email e senha abaixo para entrar (ou criar conta) no xAI. Depois clique em "Allow".
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  readOnly
                  value={job.verificationUrl}
                  className="font-mono text-xs bg-zinc-950 border-zinc-800"
                />
                <Button
                  variant="outline"
                  onClick={() => onCopy(job.verificationUrl!, "URL")}
                  className="border-zinc-700"
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  asChild
                  className="bg-emerald-600 hover:bg-emerald-500"
                >
                  <a href={job.verificationUrl} target="_blank" rel="noreferrer">
                    Abrir <ExternalLink className="size-4 ml-1" />
                  </a>
                </Button>
              </div>
              <div className="rounded-md bg-zinc-950/60 border border-zinc-800 p-3 text-xs">
                <span className="text-zinc-500">user_code:</span>{" "}
                <code className="text-emerald-300 font-bold tracking-wider">{job.userCode}</code>
              </div>
            </CardContent>
          </Card>

          {/* Email */}
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="size-4 text-cyan-400" />
                Email temporário
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                readOnly
                value={job.email || ""}
                className="font-mono text-sm bg-zinc-950 border-zinc-800"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy(job.email || "", "Email")}
                className="w-full border-zinc-700"
              >
                <Copy className="size-3 mr-2" /> Copiar email
              </Button>
            </CardContent>
          </Card>

          {/* Password */}
          <Card className="bg-zinc-900/60 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="size-4 text-amber-400" />
                Senha
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input
                  readOnly
                  type={showPassword ? "text" : "password"}
                  value={job.password || ""}
                  className="font-mono text-sm bg-zinc-950 border-zinc-800"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onTogglePassword}
                  className="border-zinc-700"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy(job.password || "", "Senha")}
                className="w-full border-zinc-700"
              >
                <Copy className="size-3 mr-2" /> Copiar senha
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Success view */}
      {isDone && job.account && (
        <Card className="bg-emerald-950/40 border-emerald-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="size-5" /> Conta criada e salva!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1 text-zinc-400">ID</div>
              <div className="col-span-2 font-mono text-xs">{job.account.id}</div>
              <div className="col-span-1 text-zinc-400">Email</div>
              <div className="col-span-2">{job.account.email || job.email}</div>
              <div className="col-span-1 text-zinc-400">Team</div>
              <div className="col-span-2 font-mono text-xs">{job.account.team_id || "—"}</div>
              <div className="col-span-1 text-zinc-400">Expira</div>
              <div className="col-span-2">{new Date(job.account.expires_at).toLocaleString("pt-BR")}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error view */}
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription className="font-mono text-xs">{job.error}</AlertDescription>
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

function getStatusMeta(status: JobRow["status"]) {
  switch (status) {
    case "creating_email":
      return {
        title: "Criando email temporário…",
        desc: "Conectando ao mail.tm",
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
        title: "Polling ativo",
        desc: "Aguardando você concluir no browser. Vamos detectar automaticamente.",
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
        title: "Conta criada com sucesso!",
        desc: "Token salvo no store do grok-proxy-cli",
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
        title: "Falha na criação",
        desc: "Veja detalhes abaixo",
        icon: <AlertCircle className="size-5" />,
        bg: "bg-red-950/40 border-red-900/60",
        border: "border-red-900/60",
        iconBg: "bg-red-500/20",
        iconColor: "text-red-300",
        titleColor: "text-red-200",
        descColor: "text-red-400/80",
      }
  }
}
