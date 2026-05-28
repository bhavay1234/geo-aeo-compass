import type { Audit, PollResult } from '../db/types';

export interface StartAuditPayload {
  brand_name: string;
  domain: string;
  competitors: string[];
  queries: string[];
}

export interface StartAuditResult {
  audit_id: string;
  query_count: number;
}

export interface AuditResult {
  audit: Audit;
  polls: PollResult[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function startAudit(payload: StartAuditPayload): Promise<StartAuditResult> {
  return request<StartAuditResult>('/api/audit/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getAuditStatus(id: string): Promise<Audit> {
  return request<Audit>(`/api/audit/status?id=${encodeURIComponent(id)}`);
}

export function getAuditResult(id: string): Promise<AuditResult> {
  return request<AuditResult>(`/api/audit/result?id=${encodeURIComponent(id)}`);
}

export function getRecentAudits(): Promise<Audit[]> {
  return request<Audit[]>('/api/audits/recent');
}
