# Tanvo MCP

[![npm](https://img.shields.io/npm/v/tanvo-mcp)](https://www.npmjs.com/package/tanvo-mcp) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The MCP server for [Tanvo](https://tanvo.ai/?utm_source=github&utm_medium=referral), an AI image, video and music studio. Ask your assistant for "a renaissance portrait of my cat from this photo", "turn this selfie into a boxed action figure", "a 10-second clip of this product spinning" or "a birthday song for Sam", and it runs it on Tanvo and hands you the file.

Works in Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Cline, Codex, Gemini CLI and any other MCP client. **No API key needed to try it**: the house image engine runs on the free tier.

## What it can do

- **80 ready-made apps with 350+ preset looks.** Pet portraits, figurines, old photo restoration, AI baby, product photos, outfit try-on, trend videos (hotel lobby duet, crying filter, dance), birthday and love songs. Each look is a tuned prompt with a real example output, so you know what you will get.
- **Images** on Nano Banana 2 / Pro, Seedream 5, GPT Image 2.5, Qwen Image, Grok Imagine and the free house engine: text to image, edits and multi-photo compositions.
- **Video** on Veo 3.1, Kling 3.0, Seedance 2.5, Wan, Minimax and more: text to video, image to video, start and end frames, native sound.
- **Songs** on Suno V6: two takes per run, each an MP3 with cover art, a title and the lyrics.
- Local photos are uploaded for you, and results can be saved straight into a folder.

## Tools

| Tool | What it does |
|---|---|
| `find_apps` | Search the apps by what the user wants ("royal pet portrait", "fix an old photo") |
| `get_app` | An app's inputs and looks, with example outputs, prompts and cost |
| `generate_from_app` | Run an app's look on the user's photos |
| `generate_image` | Text to image, or edit / combine photos |
| `generate_video` | Text or image to video (returns an id; videos take minutes) |
| `generate_music` | Write a song: describe it, bring lyrics, or go instrumental |
| `get_generation` | Status and outputs of a run; can wait and save files |
| `list_models` | Every model, its options and its credit cost |
| `account` | Free tier or account, and the credits left |
| `open_in_tanvo` | A link that opens the app, look or studio ready to go |

## Install

The server runs with `npx`, so there is nothing to install first (Node 20+).

**Claude Code**

```bash
claude mcp add tanvo -- npx -y tanvo-mcp
```

Add `-e TANVO_API_KEY=sk_...` to run on your account.

**Claude Desktop, Cursor, Windsurf, Cline, VS Code** (the `mcpServers` block of the client's MCP config)

```json
{
  "mcpServers": {
    "tanvo": {
      "command": "npx",
      "args": ["-y", "tanvo-mcp"],
      "env": { "TANVO_API_KEY": "sk_..." }
    }
  }
}
```

**Gemini CLI**

```bash
gemini extensions install https://github.com/tanvoai/tanvo-mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.tanvo]
command = "npx"
args = ["-y", "tanvo-mcp"]
env = { TANVO_API_KEY = "sk_..." }
```

## Free tier and API keys

Without a key the server uses Tanvo's anonymous free tier: the house image engine (`studio-image-v1`), watermarked, a few images per machine per day. Everything else (apps on premium models, video, songs) needs a key. When a call needs one, the server replies with a link that opens the same app or prompt in the browser, where new accounts start with free credits.

Create a key under [Settings → API keys](https://tanvo.ai/settings/apikeys?utm_source=github&utm_medium=referral). A key runs on your own account: the same models, prices and plan as the website, and every run lands in your history. Each run's price is shown by `get_app` / `list_models`, and failed runs are refunded automatically.

| Variable | Meaning |
|---|---|
| `TANVO_API_KEY` | Your API key (optional) |
| `TANVO_OUTPUT_DIR` | Save every result into this folder (optional; each call can also pass `save_to`) |
| `TANVO_BASE_URL` | Another deployment, e.g. a local build (default `https://tanvo.ai`) |
| `TANVO_ANON_ID` | Fix the free-tier id instead of the one stored in `~/.config/tanvo-mcp/anon-id` |

## Examples

> Make my dog look like a Renaissance oil painting. ~/Pictures/rex.jpg

`find_apps` → `get_app ai-pet-portrait-generator` → `generate_from_app` with look `renaissance` and the photo.

> Write a birthday song for my sister Ana, she loves surfing and terrible puns. Save it to ~/Music.

`generate_music` in Describe mode with `save_to: "~/Music"`.

> Animate this product photo into a slow 360° spin, 9:16.

`find_apps "product spin"` → `generate_from_app product-spin`, then `get_generation` until it is done.

## Privacy

Prompts and photos you pass are sent to tanvo.ai to run the job, under the [privacy policy](https://tanvo.ai/privacy-policy). Content is moderated before anything runs. The server stores nothing except the anonymous free-tier id.

## Develop

```bash
npm install
npm run build
TANVO_BASE_URL=http://localhost:3210 node dist/index.js
```

API reference: the [Python](https://github.com/tanvoai/tanvo-python) and [JavaScript](https://github.com/tanvoai/tanvo-js) client READMEs, and [tanvo.ai/llms-full.txt](https://tanvo.ai/llms-full.txt).

## Also from Tanvo

- [tanvo-python](https://github.com/tanvoai/tanvo-python): `pip install tanvo`
- [tanvo-js](https://github.com/tanvoai/tanvo-js): `npm install tanvo`

## License

MIT
