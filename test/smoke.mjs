// npm test: starts the built server over stdio, completes the MCP handshake and checks the tool list. No network.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, TANVO_BASE_URL: "http://127.0.0.1:9", TANVO_ANON_ID: "mcp-smoke-test-0001", TANVO_API_KEY: "" } });
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);
assert.equal(client.getServerVersion()?.name, "tanvo-mcp");
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ["account", "find_apps", "generate_from_app", "generate_image", "generate_music", "generate_video", "get_app", "get_generation", "list_models", "open_in_tanvo"]);
// A tool that needs the API reports the failure as a tool error instead of crashing the server.
const r = await client.callTool({ name: "list_models", arguments: {} });
assert.equal(r.isError, true);
await client.close();
console.log(`ok: ${tools.length} tools`);
