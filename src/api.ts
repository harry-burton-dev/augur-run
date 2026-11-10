// Calls AUGUR's gateway as one persona. Every call carries a W3C trace id, so the deployment's own traces
// can be found for it, and is recorded as evidence. Calls never throw on an error status: the scenario
// decides what an answer means. A shared limiter keeps the whole run under its peak rate.
import { newTraceId, type Recorder } from './evidence.ts';

export type Answer<T = unknown> = { status: number; ok: boolean; body: T; ms: number; trace: string };

/** A token bucket: at most `perSecond` calls a second across the run, with no burst above it. */
export const limiter = (perSecond: number, now = () => Date.now(), sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) => {
  const gap = 1000 / perSecond;
  let nextFree = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, nextFree);
    nextFree = at + gap;
    if (at > t) await sleep(at - t);
  };
};

export type Api = ReturnType<typeof personaApi>;

export const personaApi = (o: {
  gateway: string;
  token: () => Promise<string>;
  persona: string;
  scenario?: string;
  evidence: Recorder;
  limit: () => Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) => {
  const base = o.gateway.replace(/\/$/, '');
  const fetchImpl = o.fetchImpl ?? fetch;
  const call = async <T = unknown>(method: string, path: string, opts: { body?: unknown; floor?: string; key?: string; raw?: BodyInit; type?: string; text?: boolean } = {}): Promise<Answer<T>> => {
    await o.limit();
    const trace = newTraceId();
    const headers: Record<string, string> = {
      authorization: `Bearer ${await o.token()}`,
      traceparent: `00-${trace}-${newTraceId().slice(0, 16)}-01`,
      accept: opts.text ? '*/*' : 'application/json',
    };
    if (opts.floor) headers['x-workspace-id'] = opts.floor;
    // An action that changes something once, whatever retries the network makes, as the knowledge graph asks.
    if (opts.key) headers['idempotency-key'] = opts.key;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.raw !== undefined && opts.type) headers['content-type'] = opts.type;
    const started = performance.now();
    let status = 0;
    let body: unknown;
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
        signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      });
      status = res.status;
      body = res.status === 204 ? undefined : opts.text && res.ok ? await res.text() : await res.json().catch(() => undefined);
    } catch (err) {
      // No answer at all (refused, reset or timed out) is status 0, so a scenario sees it as down.
      body = { error: 'no_answer', message: (err as Error).message };
    }
    const ms = Math.round(performance.now() - started);
    o.evidence.call({ scenario: o.scenario, persona: o.persona, method, path, status, ms, trace, floor: opts.floor });
    return { status, ok: status >= 200 && status < 300, body: body as T, ms, trace };
  };
  return {
    persona: o.persona,
    get: <T = unknown>(path: string, opts?: { floor?: string }) => call<T>('GET', path, opts),
    post: <T = unknown>(path: string, body?: unknown, opts?: { floor?: string; key?: string }) => call<T>('POST', path, { ...opts, body }),
    put: <T = unknown>(path: string, body?: unknown, opts?: { floor?: string }) => call<T>('PUT', path, { ...opts, body }),
    patch: <T = unknown>(path: string, body?: unknown, opts?: { floor?: string }) => call<T>('PATCH', path, { ...opts, body }),
    delete: <T = unknown>(path: string, opts?: { floor?: string }) => call<T>('DELETE', path, opts),
    /** A file the gateway gives back, such as an export, as text. */
    download: (path: string, opts?: { floor?: string }) => call<string>('GET', path, { ...opts, text: true }),
    upload: <T = unknown>(path: string, raw: BodyInit, type: string, opts?: { floor?: string }) => call<T>('POST', path, { ...opts, raw, type }),
  };
};
