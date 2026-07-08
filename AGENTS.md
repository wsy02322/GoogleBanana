# AGENTS.md

## Cursor Cloud specific instructions

GoogleBanana is a self-hosted, single-page web app (Vite + React + TypeScript +
Tailwind) that mimics the Gemini "nano banana" image UI. It is driven by an
OpenRouter-style (OpenAI-compatible) API. Standard commands live in
`package.json` scripts and `README.md`; prefer those.

### Services

There is one runnable unit, started together by `npm run dev`:

- **Express proxy** (`server.js`) on port `8787` — forwards `POST /proxy` to the
  API base URL sent by the browser in the `X-OR-Base-URL` header, using the
  `Authorization` header the browser sends. The API key is never persisted
  server-side. In production (`npm start`, `NODE_ENV=production`) this same
  server also serves the built `dist/`.
- **Vite dev server** on port `5173` — the frontend; it proxies `/proxy` to the
  Express server (see `vite.config.ts`).

### Non-obvious caveats

- `npm run dev` uses `concurrently` and does **not** restart `server.js` on file
  changes (only the Vite frontend hot-reloads). After editing `server.js`,
  restart the dev process.
- Do **not** add a per-request `req.on('close', () => controller.abort())` abort
  in the proxy: with Express it aborts the upstream `fetch` prematurely and the
  response hangs. The proxy instead uses `AbortSignal.timeout` (`PROXY_TIMEOUT_MS`,
  default 300000ms) and always returns an error rather than hanging.
- Real image generation requires a valid OpenRouter key. `google/gemini-3-pro-image`
  is the default (~20s per image); `google/gemini-3.1-flash-image` is faster (~7s).
  Provide the key at runtime in the in-app Settings (stored in `localStorage`) —
  it is not read from an env var.
- OpenRouter prepends whitespace/keep-alive padding before the JSON body; the
  client reads the full body as text before parsing, so this is handled.
