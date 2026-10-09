/** Thin fetch client. Cookies carry the session; the custom header closes CSRF. */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ElevationHandler = () => Promise<boolean>;
let onElevationRequired: ElevationHandler | null = null;
let onUnauthorized: (() => void) | null = null;

export function setElevationHandler(fn: ElevationHandler | null) {
  onElevationRequired = fn;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText;
  let code: string | undefined;
  try {
    const body = await res.json();
    const detail = body.detail;
    if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object") {
      message = detail.message ?? JSON.stringify(detail);
      code = detail.code;
    }
  } catch {
    /* non-JSON error */
  }
  return new ApiError(res.status, message, code);
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Jarvis-Request", "1");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    onUnauthorized?.();
    throw await parseError(res);
  }
  if (res.status === 428 && retry && onElevationRequired) {
    const ok = await onElevationRequired();
    if (ok) return api<T>(path, init, false);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const put = <T>(path: string, json?: unknown) => api<T>(path, { method: "PUT", json: json ?? {} });
export const patch = <T>(path: string, json?: unknown) => api<T>(path, { method: "PATCH", json: json ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export async function upload(file: File): Promise<{ path: string; name: string; mime: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  return api("/api/uploads", { method: "POST", body: fd });
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
