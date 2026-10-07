// Thin client for the public API (https://tanvo.ai/api/v1).
// Identity: an API key when TANVO_API_KEY is set, otherwise an anonymous id kept on this machine (free tier).
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

export const VERSION = "0.2.0";
export const BASE_URL = (process.env.TANVO_BASE_URL ?? "https://tanvo.ai").replace(/\/$/, "");
const API_KEY = process.env.TANVO_API_KEY?.trim() || undefined;
export const hasKey = () => !!API_KEY;

/** The free-tier id: from TANVO_ANON_ID, else made once and kept in ~/.config/tanvo-mcp so the wallet survives restarts. */
function anonId() {
  if (process.env.TANVO_ANON_ID) return process.env.TANVO_ANON_ID;
  const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "tanvo-mcp");
  const file = join(dir, "anon-id");
  try {
    const id = readFileSync(file, "utf8").trim();
    if (/^[A-Za-z0-9._-]{8,80}$/.test(id)) return id;
  } catch {
    /* first run */
  }
  const id = `mcp-${randomUUID()}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, id);
  } catch {
    /* read-only home: the id lives for this process */
  }
  return id;
}
const ANON_ID = API_KEY ? "" : anonId();

/** A link back to the site, tagged so the visit shows up as coming from this server. */
export function siteUrl(path: string, params: Record<string, string | undefined> = {}) {
  const u = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set("utm_source", "mcp");
  u.searchParams.set("utm_medium", "agent");
  return u.toString();
}

export type Output = { url: string; mime: string; cover?: string; title?: string; lyrics?: string; seconds?: number };
export type Generation = {
  id: string;
  kind: "image" | "video" | "music";
  model: string;
  prompt: string;
  options: Record<string, unknown>;
  cost: number;
  status: "QUEUED" | "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  error: string | null;
  createdAt: number;
  outputs: Output[];
};
export type Model = { id: string; kind: string; name: string; free_tier: boolean; inputs: string[]; options: Record<string, unknown>; defaults: Record<string, unknown>; credits_at_defaults: number; prompt_max_chars: number; reference_images_max?: number; [k: string]: unknown };
export type Look = { id: string; name: string; prompt: string; model: string; options: Record<string, unknown>; example: { url: string; kind: string; video?: string } | null; url: string };
export type App = {
  slug: string;
  kind: "image" | "video" | "music";
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  season: string | null;
  model: string;
  models: string[];
  spec: string;
  url: string;
  example: { url: string; kind: string } | null;
  inputs: Array<{ id: string; label: string; hint: string; accept: string; min: number; max: number }>;
  looks: Look[];
};

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "user-agent": `tanvo-mcp/${VERSION}`,
      ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : { "x-anon-id": ANON_ID }),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; issues?: string[] } & T;
  if (!res.ok) throw new ApiError(body.error ?? "http_error", [body.message ?? `${res.status} from the API`, ...(body.issues ?? [])].join(" "), res.status);
  return body;
}

// The catalogues change rarely; keep them for ten minutes.
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    memo.delete(key);
    throw e;
  });
  memo.set(key, { at: Date.now(), value });
  return value;
}

export const listModels = () => cached("models", () => call<{ models: Model[] }>("/models").then((r) => r.models));
export const listApps = () => cached("apps", () => call<{ apps: App[] }>("/apps").then((r) => r.apps));
export const me = () => call<Record<string, unknown>>("/me");
export const getGeneration = (id: string) => call<{ generation: Generation }>(`/generations/${encodeURIComponent(id)}`).then((r) => r.generation);
export const submit = (body: Record<string, unknown>) => call<{ generation: Generation }>("/generations", { method: "POST", body: JSON.stringify(body) }).then((r) => r.generation);

/** Polls until the run settles or the deadline passes. */
export async function waitFor(id: string, timeoutMs: number, everyMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let g = await getGeneration(id);
  while (g.status !== "SUCCEEDED" && g.status !== "FAILED" && g.status !== "CANCELED") {
    if (Date.now() > deadline) return g;
    await new Promise((r) => setTimeout(r, everyMs));
    g = await getGeneration(id);
  }
  return g;
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4" };

/** A public https URL is passed through; a local file is uploaded first and its stored URL returned. */
export async function toUrl(ref: string): Promise<string> {
  if (/^https:\/\//i.test(ref)) return ref;
  if (/^http:\/\//i.test(ref) && !BASE_URL.startsWith("http://")) throw new Error(`Only https URLs can be fetched by the service: ${ref}`);
  const path = resolve(ref.replace(/^file:\/\//, "").replace(/^~(?=\/)/, homedir()));
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`${basename(path)}: use a PNG, JPEG or WebP image (or MP4/MOV video, MP3/WAV/M4A audio).`);
  const bytes = (await stat(path).catch(() => null))?.size;
  if (!bytes) throw new Error(`File not found: ${path}`);
  const slot = await call<{ upload_url: string; url: string }>("/uploads", { method: "POST", body: JSON.stringify({ mime, bytes }) });
  const put = await fetch(slot.upload_url, { method: "PUT", headers: { "content-type": mime }, body: await readFile(path) });
  if (!put.ok) throw new Error(`Upload of ${basename(path)} failed (${put.status}).`);
  return slot.url;
}

/** Downloads every output (and song covers) into `dir`; returns the local paths. */
export async function saveOutputs(g: Generation, dir: string): Promise<string[]> {
  const target = resolve(dir.replace(/^~(?=\/)/, homedir()));
  mkdirSync(target, { recursive: true });
  const files: string[] = [];
  for (const [i, o] of g.outputs.entries()) {
    for (const [url, suffix] of [[o.url, ""], ...(o.cover ? [[o.cover, "-cover"]] : [])] as Array<[string, string]>) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const ext = extname(new URL(url).pathname) || ".bin";
      const file = join(target, `tanvo-${g.id}-${i}${suffix}${ext}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      files.push(file);
    }
  }
  return files;
}
