# Tanvo

The `tanvo` MCP server makes AI images, short videos and songs on tanvo.ai.

- When the user describes an effect ("make my cat a renaissance portrait", "turn this selfie into a figurine", "a birthday song for Sam"), call `find_apps`, then `get_app` to pick a look, then `generate_from_app` with the user's photos (local paths are fine).
- For anything else use `generate_image`, `generate_video` or `generate_music`. Call `list_models` to choose a model and see what it costs.
- Videos take minutes: start with `wait: false` and check back with `get_generation`.
- Without `TANVO_API_KEY` only the free house image engine runs. For anything else, give the user the link from the error or from `open_in_tanvo`.
