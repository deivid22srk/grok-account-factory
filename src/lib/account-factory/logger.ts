/**
 * Browser-side logger. Stores recent log entries in localStorage so the
 * user can see exactly what happened: requests sent, errors received,
 * account rotations, OAuth polling ticks, etc.
 *
 * Capped at 500 entries (oldest dropped when full).
 */

export type LogLevel = "info" | "success" | "warn" | "error" | "debug"

export interface LogEntry {
  id: string
  ts: number
  level: LogLevel
  source: string  // "oauth" | "store" | "ui" | "system"
  msg: string
  meta?: Record<string, any>
}

const STORAGE_KEY = "grok_logs_v1"
const MAX_ENTRIES = 500

function readAll(): LogEntry[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeAll(entries: LogEntry[]) {
  if (typeof localStorage === "undefined") return
  // Trim to max
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES)
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function makeId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function log(level: LogLevel, source: string, msg: string, meta?: Record<string, any>) {
  const entry: LogEntry = {
    id: makeId(),
    ts: Date.now(),
    level,
    source,
    msg,
    meta,
  }
  const all = readAll()
  all.push(entry)
  writeAll(all)
  // Also mirror to console for dev
  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log
  consoleFn(`[${source}] ${msg}`, meta || "")
  // Notify subscribers
  notifyListeners()
  return entry
}

export function getLogs(opts?: { level?: LogLevel; source?: string; limit?: number }): LogEntry[] {
  let all = readAll()
  if (opts?.level) all = all.filter((e) => e.level === opts.level)
  if (opts?.source) all = all.filter((e) => e.source === opts.source)
  if (opts?.limit) all = all.slice(all.length - opts.limit)
  return all
}

export function clearLogs() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY)
  }
  notifyListeners()
}

// --- Listener pattern so the UI can re-render on new logs ---
const listeners = new Set<() => void>()

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notifyListeners() {
  listeners.forEach((fn) => {
    try { fn() } catch {}
  })
}

// --- Convenience helpers ---
export const logInfo = (source: string, msg: string, meta?: Record<string, any>) => log("info", source, msg, meta)
export const logSuccess = (source: string, msg: string, meta?: Record<string, any>) => log("success", source, msg, meta)
export const logWarn = (source: string, msg: string, meta?: Record<string, any>) => log("warn", source, msg, meta)
export const logError = (source: string, msg: string, meta?: Record<string, any>) => log("error", source, msg, meta)
export const logDebug = (source: string, msg: string, meta?: Record<string, any>) => log("debug", source, msg, meta)
