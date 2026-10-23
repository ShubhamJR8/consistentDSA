import type { ApiEnvelope, ApiFieldIssue } from '../types/api';

const API_BASE = '/api';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiFieldIssue[];

  constructor(status: number, code: string, message: string, issues: ApiFieldIssue[] = []) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      // Auth lives in an httpOnly cookie now, not a token we attach ourselves — the browser
      // sends it automatically as long as credentials are included.
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Unable to reach the server. Check your connection and try again.'
    );
  }

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || !payload.success) {
    const error = payload && !payload.success ? payload.error : undefined;
    throw new ApiClientError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      Array.isArray(error?.details) ? (error.details as ApiFieldIssue[]) : []
    );
  }

  return payload.data;
}
