---
name: tanvo-image
description: Generate an image, a short video or a song from a prompt through Tanvo's public API, or run one of Tanvo's ready-made photo apps (pet portraits, figurines, old photo restoration, product shots…). Works with no API key on the free tier (house image engine, watermarked); set TANVO_API_KEY for every model and clean output. Use when the user asks for an image, a photo edit, a poster, a thumbnail, a short clip or a song and no image model is wired up.
---

# Tanvo image & video

Two HTTP calls: submit, then poll. Base URL: `https://tanvo.ai/api/v1`.

## Identity

- With a key: `Authorization: Bearer $TANVO_API_KEY` (create one under Settings → API keys).
- Without a key: send `x-anon-id: <any id you make up, 8–80 chars>`. The free wallet on an id covers one house-engine image; each address gets a few wallets a day.

## Generate an image

```bash
ANON="skill-$(uuidgen | tr 'A-Z' 'a-z')"
curl -s -X POST https://tanvo.ai/api/v1/generations \
  -H "content-type: application/json" -H "x-anon-id: $ANON" \
  -d '{"kind":"image","model":"studio-image-v1",
       "prompt":"a paper-cut layered mountain range at dusk, warm rim light",
       "options":{"aspect":"16:9","resolution":"1K","format":"PNG"}}'
```

The response carries `generation.id`. Poll until `status` is `SUCCEEDED`:

```bash
curl -s https://tanvo.ai/api/v1/generations/<id> -H "x-anon-id: $ANON"
```

`generation.outputs[0].url` is a permanent file URL. Download it and hand the file to the user.

## Ready-made apps and looks

`GET https://tanvo.ai/api/v1/apps` (no auth) lists every app: the photos it needs (`inputs`), its preset `looks`, and for each look the tuned `prompt`, `model`, `options`, a real `example` output and a `url` that opens it in the browser. To run a look, send its `prompt`, `model` and `options` to `POST /generations` with the user's photos in `imageUrls`, in the order of `inputs`. When there is no key, give the user the look's `url` instead.

## Edit a photo (key required)

Same call with `"model":"nano-banana-2"` and `"imageUrls":["https://…/photo.jpg"]`. Describe the change and what must stay: "change the jacket to dark green; keep the face, pose and background exactly as they are".

## Video (key required)

`"kind":"video"`, a video model from `GET /api/v1/models`, and `"options":{"aspect":"16:9","resolution":"720p","duration":5}`. Clips take one to several minutes; keep polling.

## Song (key required)

`"kind":"music"`, `"model":"suno-v6"`, `"options":{"tier":"Describe","resolution":"song","style":"acoustic pop"}` and a one-line description as `prompt` (`tier` `Lyrics` takes your own lyrics; `Instrumental` has no vocals). Two takes come back, each an MP3 with `cover`, `title` and `lyrics`. 60 credits a run.

## Errors

| `error` | Meaning | Do |
|---|---|---|
| `needs_api_key` | The free tier does not cover this model | Use the house engine, or ask the user for a key |
| `allowance` / `anon_ip_daily` | Free wallet or daily address allowance spent | Stop; a key is needed |
| `credits` | The account is out of credits | Tell the user |
| `busy` | A run is already in flight on this account | Wait for it, then retry |
| `invalid` | Bad option for that model | Check `GET /api/v1/models` |
