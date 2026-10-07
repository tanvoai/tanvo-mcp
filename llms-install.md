# Installing the Tanvo MCP server (for AI agents)

Tanvo's MCP server is an npm package run with `npx`. There is nothing to clone or build.

## Requirements

- Node.js 20 or newer (`node --version`).

## Configuration

Add this server to the MCP settings file (for Cline: `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "tanvo": {
      "command": "npx",
      "args": ["-y", "tanvo-mcp"],
      "env": {
        "TANVO_API_KEY": ""
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

- `TANVO_API_KEY` is **optional**. Leave it empty to use the free tier (the house image engine, watermarked, a few images per machine per day). Ask the user for a key only if they want premium models, video or songs; they create one at https://tanvo.ai/settings/apikeys. Never invent a key.
- Optional: `TANVO_OUTPUT_DIR` set to a folder path saves every result there.

## Verify

After the server starts, call `list_models` (no arguments). It returns a JSON list of image, video and music models. Then try `find_apps` with `{ "query": "pet portrait" }`.

A free test image: `generate_image` with `{ "prompt": "a paper lantern over a misty lake at dawn" }`.

## Troubleshooting

- `needs_api_key`, `allowance` or `anon_ip_daily` errors: the free tier does not cover that request. Either set `TANVO_API_KEY`, or give the user the link included in the error, which opens the same request on tanvo.ai.
- `npx` cannot be found: install Node.js 20+ and restart the editor.
