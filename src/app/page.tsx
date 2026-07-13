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
  CheckCircle2, AlertCircle, Loader2, Zap, User, Activity, Eye, EyeOff, Download,
} from "lucide-react"
import { TempMailClient, extractCodeFromEmail, type TempMailAccount } from "@/lib/account-factory/tempmail-client"
import { OAuthClient, type AccountInfo } from "@/lib/account-factory/oauth-client"
import {
  listAccounts, saveAccount, removeAccount, setActive, getActiveId,
  refreshAccount, exportAccountAsGrokFormat, downloadAsFile, type StoredAccount,
} from "@/lib/account-factory/store-client"

type TabKey = "accounts" | "create"
type CreateStatus = "idle" | "creating_email" | "awaiting_authorization" | "polling" | "saved" | "error"

interface InboxMessage {
  id: string
  from: string
  subject: string
  text: string
  date: string
  code?: string | null
}

interface CreateState {
  status: CreateStatus
  mail?: TempMailAccount
  verificationUrl?: string
  userCode?: string
  account?: AccountInfo
  error?: string
  inbox: InboxMessage[]
  latestCode?: string | null
}

export default function Home() {
  const [tab, setTab] = useState<TabKey>("accounts")
  const [accounts, setAccounts] = useState<StoredAccount[]>([])
  const [activeId, setActiveId] = useState("")
  const [create, setCreate] = useState<CreateState>({ status: "idle", inbox: [] })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const inboxRef = useRef<NodeJS.Timeout | null>(null)
  const stopPollRef = useRef<boolean>(false)

  const refreshAccounts = useCallback(() => {
    setAccounts(listAccounts())
    setActiveId(getActiveId())
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPollRef.current = true
      if (pollRef.current) clearInterval(pollRef.current)
      if (inboxRef.current) clearInterval(inboxRef.current)
    }
  }, [])

  const handleCreate = async () => {
    setTab("create")
    setCreate({ status: "creating_email", inbox: [] })
    setBusy(true)
    stopPollRef.current = false

    try {
      const mail = new TempMailClient()
      const oauth = new OAuthClient()

      // 1) temp email
      const mailAcc = await mail.createAccount()
      if (stopPollRef.current) return
      setCreate((s) => ({ ...s, status: "awaiting_authorization", mail: mailAcc, inbox: [] }))

      // 2) start OAuth device flow
      const start = await oauth.startDevice()
      if (stopPollRef.current) return
      setCreate((s) => ({
        ...s,
        status: "polling",
        mail: mailAcc,
        verificationUrl: start.verification_uri_complete,
        userCode: start.user_code,
        inbox: [],
      }))
      toast({ title: "Tudo pronto — siga as instruções abaixo" })

      // 3) start inbox polling in parallel — auto-detect verification codes
      startInboxPolling(mailAcc)

      // 4) poll for token (in background, not awaited so UI stays responsive)
      oauth
        .pollDevice(start.device_code, start.interval, start.expires_in, () => {})
        .then(async (tok) => {
          if (stopPollRef.current) return
          try {
            const acc = await oauth.accountFromToken(tok)
            if (!acc.email && mailAcc) acc.email = mailAcc.address
            saveAccount(acc, true)
            setCreate((s) => ({ ...s, status: "saved", account: acc }))
            toast({ title: "Conta criada!", description: `Email: ${acc.email}` })
            refreshAccounts()
            stopInboxPolling()
          } catch (e: any) {
            setCreate((s) => ({ ...s, status: "error", error: e.message || String(e) }))
            toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" })
            stopInboxPolling()
          } finally {
            setBusy(false)
          }
        })
        .catch((e) => {
          if (stopPollRef.current) return
          setCreate((s) => ({ ...s, status: "error", error: e.message || String(e) }))
          toast({ title: "OAuth falhou", description: e.message, variant: "destructive" })
          stopInboxPolling()
          setBusy(false)
        })
    } catch (e: any) {
      setCreate((s) => ({ ...s, status: "error", error: e.message || String(e) }))
      toast({ title: "Erro ao iniciar criação", description: e.message, variant: "destructive" })
      setBusy(false)
    }
  }

  // Poll the mail.tm inbox every 5s and surface new messages + extracted codes
  const startInboxPolling = (mailAcc: TempMailAccount) => {
    stopInboxPolling()
    const mail = new TempMailClient()
    const seen = new Set<string>()
    let latestCode: string | null = null

    const tick = async () => {
      if (stopPollRef.current) {
        stopInboxPolling()
        return
      }
      try {
        const inbox = await mail.fetchInbox(mailAcc)
        const newMessages: InboxMessage[] = []
        for (const msg of inbox) {
          const id = msg.id || (msg["@id"] || "").split("/").pop()
          if (!id || seen.has(id)) continue
          seen.add(id)
          const full = await mail.getMessage(mailAcc, id)
          const body = (full.text || "") + "\n" + (full.html || "")
          const code = extractCodeFromEmail(body)
          newMessages.push({
            id,
            from: typeof full.from === "object" && full.from ? full.from.address || "" : String(full.from || ""),
            subject: full.subject || "",
            text: full.text || "",
            date: full.createdAt || new Date().toISOString(),
            code,
          })
          if (code && !latestCode) {
            latestCode = code
            toast({ title: "Código recebido!", description: code })
          }
        }
        if (newMessages.length > 0) {
          setCreate((s) => {
            const merged = [...newMessages, ...s.inbox]
            const newLatest = latestCode || s.latestCode
            return { ...s, inbox: merged, latestCode: newLatest }
          })
        }
      } catch (e) {
        // network hiccup, retry next tick
      }
    }

    // Run immediately + every 5s
    tick()
    inboxRef.current = setInterval(tick, 5000)
  }

  const stopInboxPolling = () => {
    if (inboxRef.current) {
      clearInterval(inboxRef.current)
      inboxRef.current = null
    }
  }

  const handleCancelCreate = () => {
    stopPollRef.current = true
    if (pollRef.current) clearInterval(pollRef.current)
    stopInboxPolling()
    setCreate({ status: "idle", inbox: [] })
    setBusy(false)
    setTab("accounts")
  }

  const handleActivate = (id: string) => {
    if (setActive(id)) {
      refreshAccounts()
      toast({ title: "Conta ativada" })
    }
  }

  const handleRefresh = async (id: string) => {
    setBusy(true)
    try {
      await refreshAccount(id)
      refreshAccounts()
      toast({ title: "Token renovado" })
    } catch (e: any) {
      toast({ title: "Erro ao renovar", description: e.message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = (id: string) => {
    if (!confirm(`Remover conta ${id.slice(0, 16)}…?`)) return
    if (removeAccount(id)) {
      refreshAccounts()
      toast({ title: "Conta removida" })
    }
  }

  const handleExport = (acc: StoredAccount) => {
    const json = exportAccountAsGrokFormat(acc)
    downloadAsFile(`${acc.id}.json`, json)
    toast({ title: "Conta exportada", description: `${acc.id}.json` })
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: `${label} copiado` })
  }

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
              <p className="text-xs text-zinc-400">Criação e gestão de contas para grok-proxy-cli</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshAccounts}>
              <RefreshCw className="size-4 mr-2" />
              Atualizar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={busy}>
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
              <User className="size-4 mr-2" /> Contas ({accounts.length})
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
                  Contas salvas neste navegador (localStorage). Use <b>Exportar</b> para baixar
                  cada conta no formato do grok-proxy-cli (<code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-xs">~/.local/share/GrokDesktop/accounts/&lt;id&gt;.json</code>).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {accounts.length === 0 ? (
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
                        {accounts.map((a) => {
                          const expired = a.expires_at ? new Date(a.expires_at).getTime() < Date.now() : false
                          return (
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
                                  {a.id === activeId && (
                                    <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white">
                                      <Star className="size-3 mr-1" /> Ativa
                                    </Badge>
                                  )}
                                  {expired ? (
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
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleActivate(a.id)}
                                    disabled={a.id === activeId}
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
                                    onClick={() => handleExport(a)}
                                    title="Exportar JSON"
                                    className="hover:bg-amber-500/20 hover:text-amber-300"
                                  >
                                    <Download className="size-4" />
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
                          )
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Create tab */}
          <TabsContent value="create" className="mt-6">
            {create.status === "idle" ? (
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
                state={create}
                showPassword={showPassword}
                onTogglePassword={() => setShowPassword(!showPassword)}
                onCopy={copyToClipboard}
                onCancel={handleCancelCreate}
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
    { n: 1, title: "Email temporário", desc: "Criamos um endereço @mail.tm para receber o código de verificação do xAI" },
    { n: 2, title: "Você cria a conta xAI", desc: "Abre o link, clica em Sign up, usa o email temporário e ESCOLHE SUA PRÓPRIA senha" },
    { n: 3, title: "Código auto-detectado", desc: "xAI envia o código de verificação → pegamos do mail.tm automaticamente e te mostramos" },
    { n: 4, title: "Token salvo", desc: "Você autoriza o grok-proxy-cli → recebemos o access_token + refresh_token" },
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
  state,
  showPassword,
  onTogglePassword,
  onCopy,
  onCancel,
}: {
  state: CreateState
  showPassword: boolean
  onTogglePassword: () => void
  onCopy: (text: string, label: string) => void
  onCancel: () => void
}) {
  const statusMeta = getStatusMeta(state.status)
  const isDone = state.status === "saved"
  const isError = state.status === "error"
  const isWaiting = state.status === "awaiting_authorization" || state.status === "polling" || state.status === "creating_email"
  const hasCode = !!state.latestCode

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
              {isWaiting && state.status !== "creating_email" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="size-3 animate-spin" />
                  Monitorando email + OAuth a cada 5s — aguardando você concluir…
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === STEP 1: Open the link === */}
      {isWaiting && state.verificationUrl && (
        <Card className="bg-zinc-900/60 border-zinc-800 border-emerald-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="size-6 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center">1</span>
              <ExternalLink className="size-4 text-emerald-400" />
              Abra este link no seu navegador
            </CardTitle>
            <CardDescription>
              Esta é a página oficial do xAI para autorizar o <code className="text-emerald-300 bg-zinc-800 px-1 rounded">grok-proxy-cli</code>.
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
            </div>
          </CardContent>
        </Card>
      )}

      {/* === STEP 2: Sign up with email + your own password === */}
      {isWaiting && state.mail && (
        <Card className="bg-zinc-900/60 border-zinc-800 border-cyan-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="size-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold flex items-center justify-center">2</span>
              <Mail className="size-4 text-cyan-400" />
              Na página do xAI, clique em <span className="text-cyan-300">"Sign up"</span> e use:
            </CardTitle>
            <CardDescription>
              ⚠️ <b>Não use "Sign in"</b> — a conta ainda não existe. Clique em <b>Sign up</b> / <b>Create account</b>.
              Escolha <b>SUA PRÓPRIA senha</b> para o xAI (você decide qual).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {/* Email */}
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Email temporário (use no xAI)</Label>
                <Input
                  readOnly
                  value={state.mail.address}
                  className="font-mono text-sm bg-zinc-950 border-zinc-800"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopy(state.mail!.address, "Email")}
                  className="w-full border-zinc-700"
                >
                  <Copy className="size-3 mr-2" /> Copiar email
                </Button>
              </div>

              {/* mail.tm password (just for reading the email) */}
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">
                  Senha do mail.tm (só pra ler o email — NÃO use no xAI)
                </Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    type={showPassword ? "text" : "password"}
                    value={state.mail.password}
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
                  onClick={() => onCopy(state.mail!.password, "Senha mail.tm")}
                  className="w-full border-zinc-700"
                >
                  <Copy className="size-3 mr-2" /> Copiar senha mail.tm
                </Button>
              </div>
            </div>

            <Alert className="border-amber-900/40 bg-amber-950/20">
              <AlertCircle className="size-4 text-amber-400" />
              <AlertDescription className="text-xs text-amber-200/80">
                <b>Resumo:</b> No xAI você vai criar a conta com o email acima + uma senha que VOCÊ escolhe.
                A senha do mail.tm mostrada aqui serve só pra você acessar a caixa de entrada se quiser ver os emails manualmente —
                nós já vamos detectar os códigos automaticamente abaixo.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* === STEP 3: Verification code (auto-detected) === */}
      {isWaiting && (
        <Card className={`bg-zinc-900/60 border-2 ${hasCode ? "border-emerald-500 shadow-lg shadow-emerald-500/20" : "border-zinc-800 border-dashed"}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`size-6 rounded-full ${hasCode ? "bg-emerald-500" : "bg-zinc-700"} text-white text-xs font-bold flex items-center justify-center`}>3</span>
              {hasCode ? (
                <span className="flex items-center gap-2 text-emerald-300">
                  <Key className="size-4" /> Código de verificação recebido!
                </span>
              ) : (
                <span className="flex items-center gap-2 text-zinc-300">
                  <Clock className="size-4 animate-pulse" /> Aguardando código de verificação do xAI…
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {hasCode
                ? "Copie este código e cole na página do xAI."
                : "Assim que o xAI enviar o código, vamos pegá-lo do mail.tm e mostrar aqui automaticamente."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasCode ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={state.latestCode || ""}
                    className="font-mono text-3xl text-center tracking-[0.5em] font-bold bg-zinc-950 border-emerald-700 text-emerald-300 py-6"
                  />
                  <Button
                    size="lg"
                    onClick={() => onCopy(state.latestCode || "", "Código")}
                    className="bg-emerald-600 hover:bg-emerald-500 px-6"
                  >
                    <Copy className="size-5" />
                  </Button>
                </div>
                <p className="text-xs text-emerald-400/80 text-center">
                  ✅ Detectado automaticamente do email recebido no mail.tm
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 gap-3 text-zinc-500">
                <Loader2 className="size-5 animate-spin" />
                <span className="text-sm">Checando inbox a cada 5s…</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* === STEP 4: Authorize === */}
      {isWaiting && state.verificationUrl && (
        <Card className="bg-zinc-900/60 border-zinc-800 border-amber-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="size-6 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold flex items-center justify-center">4</span>
              <CheckCircle2 className="size-4 text-amber-400" />
              Depois de logado, clique em <span className="text-amber-300">"Allow"</span>
            </CardTitle>
            <CardDescription>
              O xAI vai perguntar se você autoriza o <code className="text-zinc-300 bg-zinc-800 px-1 rounded">grok-proxy-cli</code> a
              acessar sua conta. Clique em <b>Allow</b> e pronto — vamos detectar o token automaticamente.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Inbox messages (transparency) */}
      {isWaiting && state.inbox.length > 0 && (
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-zinc-400" />
              Emails recebidos no mail.tm ({state.inbox.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-64 rounded-md">
              <div className="space-y-2">
                {state.inbox.map((m) => (
                  <div key={m.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-zinc-400 truncate">{m.from}</span>
                      {m.code && (
                        <Badge variant="default" className="bg-emerald-600 text-white shrink-0">
                          code: {m.code}
                        </Badge>
                      )}
                    </div>
                    <div className="text-zinc-200 font-medium mb-1">{m.subject}</div>
                    <div className="text-zinc-500 line-clamp-2 font-mono text-[10px]">
                      {m.text.slice(0, 200)}…
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Success view */}
      {isDone && state.account && (
        <Card className="bg-emerald-950/40 border-emerald-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="size-5" /> Conta criada e salva!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1 text-zinc-400">ID</div>
              <div className="col-span-2 font-mono text-xs">{state.account.id}</div>
              <div className="col-span-1 text-zinc-400">Email</div>
              <div className="col-span-2">{state.account.email}</div>
              <div className="col-span-1 text-zinc-400">Team</div>
              <div className="col-span-2 font-mono text-xs">{state.account.team_id || "—"}</div>
              <div className="col-span-1 text-zinc-400">Expira</div>
              <div className="col-span-2">{new Date(state.account.expires_at).toLocaleString("pt-BR")}</div>
            </div>
            <div className="pt-3 border-t border-emerald-900/40 text-xs text-emerald-400/80">
              ✅ A conta foi salva no navegador. Volte para a aba <b>Contas</b> para exportá-la no
              formato do grok-proxy-cli.
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

function getStatusMeta(status: CreateStatus) {
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
        desc: "Token salvo no navegador",
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
