#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiError, BASE_URL, VERSION, getGeneration, hasKey, listApps, listModels, me, saveOutputs, siteUrl, submit, toUrl, waitFor, type App, type Generation } from "./api.js";

const server = new McpServer(
  { name: "tanvo-mcp", version: VERSION, title: "Tanvo", websiteUrl: "https://tanvo.ai" },
  {
    instructions:
      "Tanvo (tanvo.ai) makes AI images, short videos and songs. When the user describes an effect (\"make my dog a renaissance portrait\", \"turn this selfie into an action figure\", \"a birthday song for Sam\"), call find_apps first: each app is a tuned recipe with preset looks and real example outputs, and generate_from_app runs one on the user's photos. For free-form work use generate_image, generate_video or generate_music. Without TANVO_API_KEY only the free house image engine works; everything else returns a link the user can open in the browser.",
  },
);

type Content = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
const text = (t: string): { content: Content } => ({ content: [{ type: "text", text: t }] });
const saveDir = (dir?: string) => dir ?? process.env.TANVO_OUTPUT_DIR;
/** The model's own defaults, overridden by what the caller set (undefined values are left out). */
async function optionsFor(modelId: string, given: Record<string, unknown>) {
  const m = (await listModels()).find((x) => x.id === modelId);
  return { ...(m?.defaults ?? {}), ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) };
}

/** What a finished (or still running) generation looks like to the model. */
async function present(g: Generation, opts: { inline?: boolean; save?: string } = {}): Promise<Content> {
  const done = g.status === "SUCCEEDED";
  const saved = done && opts.save ? await saveOutputs(g, opts.save).catch((e) => [`(could not save: ${e instanceof Error ? e.message : e})`]) : undefined;
  const summary = {
    id: g.id,
    status: g.status,
    kind: g.kind,
    model: g.model,
    credits_charged: g.cost,
    outputs: g.outputs.map((o) => (g.kind === "music" ? { mp3: o.url, cover: o.cover, title: o.title, seconds: o.seconds, lyrics: o.lyrics } : o.url)),
    saved_to: saved,
    error: g.error ?? undefined,
    history: siteUrl("/history"),
    next_step: done ? undefined : g.status === "FAILED" ? "The run failed and its credits were refunded." : `Still running. Call get_generation with id "${g.id}" (and wait: true) in a moment.`,
  };
  const content: Content = [{ type: "text", text: JSON.stringify(summary, null, 2) }];
  // A small image is returned inline so the client can show it; video and audio stay as links.
  if (opts.inline && done && g.kind === "image" && g.outputs[0]) {
    try {
      const buf = Buffer.from(await (await fetch(g.outputs[0].url)).arrayBuffer());
      if (buf.length < 4 * 1024 * 1024) content.push({ type: "image", data: buf.toString("base64"), mimeType: g.outputs[0].mime || "image/png" });
    } catch {
      /* the URL in the text is enough */
    }
  }
  return content;
}

function failure(e: unknown, open?: string): { content: Content; isError: true } {
  const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
  const needsKey = e instanceof ApiError && ["needs_api_key", "allowance", "anon_ip_daily", "trial_closed", "unauthorized"].includes(e.code) && !hasKey();
  const hint = needsKey
    ? `\n\nThis needs a Tanvo account. Either set TANVO_API_KEY (create one at ${siteUrl("/settings/apikeys")}), or open ${open ?? siteUrl("/")} and run it in the browser (new accounts get free credits).`
    : e instanceof ApiError && e.code === "credits"
      ? `\n\nTop up at ${siteUrl("/pricing")}.`
      : "";
  return { content: [{ type: "text", text: msg + hint }], isError: true };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 1 && !STOP.has(w));
const STOP = new Set(["a", "an", "the", "my", "me", "of", "to", "into", "in", "on", "for", "and", "with", "make", "turn", "ai", "generator", "photo", "picture", "image", "this", "it", "like", "from", "look", "looks", "want", "some", "our", "us"]);
// Everyday words users say for what the catalogue calls something else.
const ALIAS: Record<string, string[]> = { dog: ["pet"], cat: ["pet"], puppy: ["pet"], kitten: ["pet"], selfie: ["face"], song: ["music"], music: ["song"], restore: ["restoration", "old"], fix: ["restoration"], figure: ["figurine"], toy: ["figurine"], king: ["royal"], queen: ["royal"], baby: ["baby"], wedding: ["wedding"], clip: ["video"] };

function score(app: App, q: string[]) {
  if (!q.length) return 1;
  const terms = [...new Set(q.flatMap((t) => [t, ...(ALIAS[t] ?? [])]))];
  const field = (s: string, w: number) => {
    const have = words(s);
    return terms.reduce((n, t) => n + (have.some((x) => x === t || (t.length > 3 && x.startsWith(t.slice(0, -1)))) ? w : 0), 0);
  };
  return field(app.name, 4) + field(app.slug, 3) + field(app.description, 2) + field(app.category ?? "", 2) + field(app.looks.map((l) => l.name).join(" "), 2) + field(app.looks.map((l) => l.prompt).join(" "), 0.5) + field(app.spec, 1);
}

function appLine(a: App) {
  const photos = a.inputs.filter((i) => i.min > 0).map((i) => i.label);
  return `- **${a.name}** (\`${a.slug}\`, ${a.kind}${a.category ? `, ${a.category}` : ""}): ${a.description} Needs: ${photos.length ? photos.join(" + ") : "just a prompt"}. ${a.looks.length > 1 ? `${a.looks.length} looks. ` : ""}${siteUrl(a.url)}`;
}

server.registerTool(
  "find_apps",
  {
    title: "Find a Tanvo app",
    description:
      "Search Tanvo's ready-made AI apps (photo effects, trends, portraits, product shots, video effects, songs) by what the user wants, e.g. 'royal pet portrait', 'action figure of me', 'old photo restoration', 'dancing video', 'birthday song'. Each app has tuned preset looks with real example outputs. Use get_app for the looks, then generate_from_app to run one.",
    inputSchema: {
      query: z.string().optional().describe("What the user wants, in their words. Leave empty to list trending apps."),
      kind: z.enum(["image", "video", "music"]).optional().describe("Only apps that make this kind of media"),
      limit: z.number().int().min(1).max(30).default(8),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, kind, limit }) => {
    try {
      const q = words(query ?? "");
      const ranked = (await listApps())
        .filter((a) => !kind || a.kind === kind)
        .map((a, i) => ({ a, s: score(a, q), i }))
        .filter((x) => x.s > 0)
        .sort((x, y) => y.s - x.s || x.i - y.i)
        .slice(0, limit);
      if (!ranked.length) return text(`No Tanvo app matched "${query}". Use generate_image / generate_video with a written prompt, or browse ${siteUrl("/image")} and ${siteUrl("/video")}.`);
      return text(`Tanvo apps${query ? ` for "${query}"` : ""}:\n\n${ranked.map((x) => appLine(x.a)).join("\n")}\n\nNext: get_app with a slug to see its looks.`);
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "get_app",
  {
    title: "Show an app and its looks",
    description: "One Tanvo app: the photos it needs, its preset looks (each with an example output and the prompt behind it), the model it runs on and the link that opens it in the browser.",
    inputSchema: { app: z.string().describe("App slug from find_apps") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ app }) => {
    try {
      const a = (await listApps()).find((x) => x.slug === app);
      if (!a) return { ...text(`Unknown app "${app}". Call find_apps to get a slug.`), isError: true };
      const models = await listModels();
      const cost = (id: string) => models.find((m) => m.id === id)?.credits_at_defaults;
      const lines = [
        `# ${a.name} (${a.kind})`,
        a.description,
        `Spec: ${a.spec}. Open: ${siteUrl(a.url)}`,
        "",
        "## Inputs",
        ...(a.inputs.length ? a.inputs.map((i) => `- ${i.label}${i.min === 0 ? " (optional)" : ""}${i.max > 1 ? `, up to ${i.max}` : ""}: ${i.hint}`) : ["- none, just the prompt"]),
        "",
        "## Looks",
        ...a.looks.map((l) => `- **${l.name}** (\`${l.id}\`), model ${l.model}${cost(l.model) ? `, about ${cost(l.model)} credits` : ""}. Example: ${l.example?.video ?? l.example?.url ?? "none"}. Open with this look: ${siteUrl(l.url)}\n  Prompt: ${l.prompt}`),
      ];
      return text(lines.join("\n"));
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "list_models",
  {
    title: "List models",
    description: "Every image, video and music model with the options each accepts (aspect, resolution, duration, format, audio), how many reference images it takes, whether the free tier covers it, and its credit cost at default settings.",
    inputSchema: { kind: z.enum(["image", "video", "music"]).optional().describe("Filter by media kind") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ kind }) => {
    try {
      const models = (await listModels()).filter((m) => !kind || m.kind === kind);
      return text(JSON.stringify(models, null, 2));
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "account",
  {
    title: "Account and credits",
    description: "Who the server runs as (an API key account or the anonymous free tier) and how many credits are left.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return text(JSON.stringify({ ...(await me()), api_key: hasKey() ? "set" : "not set (free tier)", base_url: BASE_URL }, null, 2));
    } catch (e) {
      return failure(e);
    }
  },
);

// ─── Generation ─────────────────────────────────────────────────────────────

const refs = z.array(z.string()).max(14).default([]).describe("Photos as local file paths or public https URLs. Local files are uploaded for you.");
const saveTo = z.string().optional().describe("Optional folder to download the results into (defaults to TANVO_OUTPUT_DIR when set)");

server.registerTool(
  "generate_from_app",
  {
    title: "Run a Tanvo app",
    description:
      "Run one of Tanvo's apps with one of its looks on the user's photos, e.g. the 'renaissance' look of a pet portrait app. Photos go in the order of the app's inputs (see get_app). Uses the look's tuned prompt and model; `details` adds the user's own touch. Charges the look model's credits (shown by get_app) and refunds failures. Needs TANVO_API_KEY unless the look runs on the free engine.",
    inputSchema: {
      app: z.string().describe("App slug from find_apps"),
      look: z.string().optional().describe("Look id from get_app; defaults to the first look"),
      photos: refs,
      details: z.string().max(200).optional().describe("Optional personal detail woven into the prompt, e.g. 'for my sister Ana' or 'wearing a red scarf'"),
      wait: z.boolean().optional().describe("Wait for the result. Defaults to true for images and songs, false for video."),
      save_to: saveTo,
    },
    annotations: { openWorldHint: true },
  },
  async (a) => {
    let open: string | undefined;
    try {
      const app = (await listApps()).find((x) => x.slug === a.app);
      if (!app) return { ...text(`Unknown app "${a.app}". Call find_apps to get a slug.`), isError: true };
      const look = a.look ? app.looks.find((l) => l.id === a.look) : app.looks[0];
      if (!look) return { ...text(`"${app.name}" has no look "${a.look}". Looks: ${app.looks.map((l) => l.id).join(", ")}.`), isError: true };
      open = siteUrl(look.url);
      const needed = app.inputs.filter((i) => i.min > 0).length;
      if (a.photos.length < needed) return { ...text(`${app.name} needs ${needed} photo(s): ${app.inputs.filter((i) => i.min > 0).map((i) => i.label).join(", ")}. Got ${a.photos.length}.`), isError: true };
      const models = await listModels();
      const model = models.find((m) => m.id === look.model);
      const options = { ...(model?.defaults ?? {}), ...look.options };
      const prompt = a.details ? `${look.prompt}\n\nThis one is for: ${a.details.trim()}.` : look.prompt;
      if (app.kind === "music") {
        let g = await submit({ kind: "music", model: look.model, prompt, options });
        if (a.wait ?? true) g = await waitFor(g.id, 5 * 60_000);
        return { content: await present(g, { save: saveDir(a.save_to) }) };
      }
      const imageUrls = await Promise.all(a.photos.map(toUrl));
      let g = await submit({ kind: app.kind, model: look.model, prompt, options, imageUrls });
      if (a.wait ?? app.kind === "image") g = await waitFor(g.id, app.kind === "video" ? 8 * 60_000 : 180_000, app.kind === "video" ? 6000 : 4000);
      return { content: await present(g, { inline: true, save: saveDir(a.save_to) }) };
    } catch (e) {
      return failure(e, open);
    }
  },
);

server.registerTool(
  "generate_image",
  {
    title: "Generate or edit an image",
    description: "Text to image, or an edit / combination when `images` are given. Returns the image (inline when small) and its URL. The free tier runs studio-image-v1 without a key; other models need TANVO_API_KEY. Credits are charged per run and refunded if it fails.",
    inputSchema: {
      prompt: z.string().min(1).describe("What to make: subject, setting, light and style. For edits, say what to change and what to keep."),
      model: z.string().default("studio-image-v1").describe("Model id from list_models"),
      aspect: z.string().optional().describe("1:1, 16:9, 9:16, 4:3, 3:4 … as the model allows (default: the model's)"),
      resolution: z.string().optional().describe("1K, 2K or 4K where the model supports it (default: the model's)"),
      format: z.enum(["PNG", "JPG", "WEBP"]).optional(),
      images: refs,
      wait: z.boolean().default(true).describe("Wait for the image (usually under a minute)"),
      save_to: saveTo,
    },
    annotations: { openWorldHint: true },
  },
  async (a) => {
    try {
      const imageUrls = await Promise.all(a.images.map(toUrl));
      let g = await submit({ kind: "image", model: a.model, prompt: a.prompt, options: await optionsFor(a.model, { aspect: a.aspect, resolution: a.resolution, format: a.format }), imageUrls });
      if (a.wait) g = await waitFor(g.id, 180_000);
      return { content: await present(g, { inline: true, save: saveDir(a.save_to) }) };
    } catch (e) {
      return failure(e, siteUrl("/image", { prompt: a.prompt }));
    }
  },
);

server.registerTool(
  "generate_video",
  {
    title: "Generate a video",
    description: "Text to video, or animate a still when `image` is given (optionally ending on `end_image`). Video takes one to several minutes, so by default this returns at once with an id for get_generation. Needs TANVO_API_KEY.",
    inputSchema: {
      prompt: z.string().min(1).describe("One scene: subject, action, camera movement, light and style"),
      model: z.string().default("studio-video-v1").describe("Model id from list_models"),
      aspect: z.string().optional().describe("16:9, 9:16, 1:1 … (default: the model's)"),
      resolution: z.string().optional().describe("480p, 720p, 1080p or 4K where supported (default: the model's)"),
      duration: z.number().int().optional().describe("Seconds; one of the model's options (default: the model's)"),
      audio: z.boolean().optional().describe("Native sound on models that offer it"),
      image: z.string().optional().describe("Start frame: a local path or a public https URL"),
      end_image: z.string().optional().describe("End frame on models that support it"),
      wait: z.boolean().default(false).describe("Wait for the clip (up to 8 minutes)"),
      save_to: saveTo,
    },
    annotations: { openWorldHint: true },
  },
  async (a) => {
    try {
      const imageUrls = a.image ? [await toUrl(a.image)] : [];
      const endImageUrl = a.end_image ? await toUrl(a.end_image) : undefined;
      let g = await submit({ kind: "video", model: a.model, prompt: a.prompt, options: await optionsFor(a.model, { aspect: a.aspect, resolution: a.resolution, duration: a.duration, audio: a.audio }), imageUrls, endImageUrl });
      if (a.wait) g = await waitFor(g.id, 8 * 60_000, 6000);
      return { content: await present(g, { save: saveDir(a.save_to) }) };
    } catch (e) {
      return failure(e, siteUrl("/video", { prompt: a.prompt }));
    }
  },
);

server.registerTool(
  "generate_music",
  {
    title: "Write a song",
    description: "Makes two takes of a song on Suno V6, each an MP3 with cover art, a title and the lyrics as sung. Modes: Describe (prompt is one sentence about the song; lyrics are written for you), Lyrics (prompt is your lyrics, with [Verse] [Chorus] [Bridge] tags), Instrumental (prompt describes the sound). 60 credits a run; needs TANVO_API_KEY.",
    inputSchema: {
      prompt: z.string().min(1).max(5000),
      mode: z.enum(["Describe", "Lyrics", "Instrumental"]).default("Describe"),
      style: z.string().max(200).optional().describe("Genre, instruments, tempo, voice, e.g. 'acoustic pop, hand claps, warm female vocal'"),
      title: z.string().max(80).optional().describe("Song title (Lyrics and Instrumental modes)"),
      vocal: z.enum(["m", "f"]).optional().describe("Lean towards a male or female voice (Lyrics mode)"),
      wait: z.boolean().default(true).describe("Wait for the songs (usually about a minute)"),
      save_to: saveTo,
    },
    annotations: { openWorldHint: true },
  },
  async (a) => {
    try {
      const options = { tier: a.mode, resolution: "song", ...(a.style ? { style: a.style } : {}), ...(a.title ? { title: a.title } : {}), ...(a.vocal ? { vocal: a.vocal } : {}) };
      let g = await submit({ kind: "music", model: "suno-v6", prompt: a.prompt, options });
      if (a.wait) g = await waitFor(g.id, 5 * 60_000);
      return { content: await present(g, { save: saveDir(a.save_to) }) };
    } catch (e) {
      return failure(e, siteUrl("/music"));
    }
  },
);

server.registerTool(
  "get_generation",
  {
    title: "Check a generation",
    description: "Status and outputs of a run started earlier (poll this for videos).",
    inputSchema: { id: z.string(), wait: z.boolean().default(false).describe("Wait up to 2 minutes for it to finish"), save_to: saveTo },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ id, wait, save_to }) => {
    try {
      const g = wait ? await waitFor(id, 120_000) : await getGeneration(id);
      return { content: await present(g, { inline: true, save: saveDir(save_to) }) };
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "open_in_tanvo",
  {
    title: "Open in the browser",
    description: "A link that opens Tanvo ready to go: an app on a chosen look, or the image / video / music studio with a model and prompt filled in. Use it when the user wants to upload photos and tweak settings themselves, or has no API key.",
    inputSchema: {
      app: z.string().optional().describe("App slug from find_apps"),
      look: z.string().optional().describe("Look id from get_app"),
      kind: z.enum(["image", "video", "music"]).optional().describe("Studio to open when no app is given"),
      model: z.string().optional().describe("Model id to open the studio on"),
      prompt: z.string().max(2000).optional().describe("Prompt to prefill"),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    try {
      if (a.app) {
        const app = (await listApps()).find((x) => x.slug === a.app);
        if (!app) return { ...text(`Unknown app "${a.app}". Call find_apps to get a slug.`), isError: true };
        const look = a.look ? app.looks.find((l) => l.id === a.look) : undefined;
        return text(look ? siteUrl(look.url) : siteUrl(app.url));
      }
      const kind = a.kind ?? "image";
      return text(siteUrl(`/${kind}${a.model && kind !== "music" ? `/${a.model}` : ""}`, { prompt: a.prompt }));
    } catch (e) {
      return failure(e);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error(`tanvo-mcp ${VERSION} on stdio (${BASE_URL}, ${hasKey() ? "API key" : "free tier"})`);
