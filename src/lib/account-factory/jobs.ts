/**
 * In-memory job manager for account creation flows.
 *
 * Each job tracks the lifecycle of one account creation:
 *   1. create temp email
 *   2. start OAuth device flow
 *   3. poll until user authorizes
 *   4. save to store
 */
import { TempMailClient, TempMailAccount } from "./tempmail";
import { OAuthClient, AccountInfo } from "./oauth";
import { writeAccount, defaultDataDir } from "./store";

export type JobStatus = "creating_email" | "awaiting_authorization" | "polling" | "saved" | "error";

export interface CreateJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  // available when status === "awaiting_authorization" or "polling"
  email?: string;
  password?: string;
  verificationUrl?: string;
  userCode?: string;
  // available when status === "saved"
  account?: AccountInfo;
  // available when status === "error"
  error?: string;
}

const jobs = new Map<string, CreateJob>();
const timers = new Map<string, NodeJS.Timeout>();

function makeId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function update(id: string, patch: Partial<CreateJob>) {
  const cur = jobs.get(id);
  if (!cur) return;
  Object.assign(cur, patch, { updatedAt: Date.now() });
}

export function getJob(id: string): CreateJob | undefined {
  return jobs.get(id);
}

export function listJobs(): CreateJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function startCreateJob(opts?: { expiresInSec?: number }): Promise<CreateJob> {
  const id = makeId();
  const job: CreateJob = {
    id,
    status: "creating_email",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);

  const mailClient = new TempMailClient();
  const oauth = new OAuthClient();

  try {
    // 1) temp email
    const mail = await mailClient.createAccount();
    update(id, { email: mail.address, password: mail.password });

    // 2) start OAuth device flow
    job.status = "awaiting_authorization";
    job.updatedAt = Date.now();
    const start = await oauth.startDevice();
    update(id, {
      status: "awaiting_authorization",
      email: mail.address,
      password: mail.password,
      verificationUrl: start.verification_uri_complete,
      userCode: start.user_code,
    });

    // 3) poll in background (don't await — return immediately so the UI can show the URL)
    pollInBackground(id, mail, oauth, start, opts?.expiresInSec ?? 1800);

    return job;
  } catch (e: any) {
    update(id, { status: "error", error: e.message || String(e) });
    return job;
  }
}

function pollInBackground(
  jobId: string,
  mail: TempMailAccount,
  oauth: OAuthClient,
  start: Awaited<ReturnType<OAuthClient["startDevice"]>>,
  expiresInSec: number
) {
  update(jobId, { status: "polling" });

  const stopPolling = () => {
    const t = timers.get(jobId);
    if (t) {
      clearTimeout(t);
      timers.delete(jobId);
    }
  };

  // Use the polling method with a no-op tick callback (we update status via setJob)
  oauth
    .pollDevice(start.device_code, start.interval, expiresInSec, () => {
      // tick — could update a lastCheckedAt field
    })
    .then(async (tok) => {
      try {
        const acc = await oauth.accountFromToken(tok);
        if (!acc.email) acc.email = mail.address;
        const dir = process.env.GROK_DATA_DIR || defaultDataDir();
        writeAccount(acc, dir, true);
        update(jobId, { status: "saved", account: acc });
        stopPolling();
      } catch (e: any) {
        update(jobId, { status: "error", error: e.message || String(e) });
        stopPolling();
      }
    })
    .catch((e) => {
      update(jobId, { status: "error", error: e.message || String(e) });
      stopPolling();
    });

  // Hard safety timeout
  const t = setTimeout(() => {
    if (jobs.get(jobId)?.status === "polling") {
      update(jobId, { status: "error", error: "polling timed out" });
    }
    stopPolling();
  }, expiresInSec * 1000 + 60000);
  timers.set(jobId, t);
}

export function cancelJob(id: string): boolean {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  const job = jobs.get(id);
  if (!job) return false;
  update(id, { status: "error", error: "cancelled by user" });
  return true;
}

// Cleanup old jobs every 10 minutes (keep last 50)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const all = listJobs();
    if (all.length > 50) {
      for (const old of all.slice(50)) {
        jobs.delete(old.id);
      }
    }
  }, 10 * 60 * 1000);
}
