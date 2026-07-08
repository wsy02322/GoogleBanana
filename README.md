# GoogleBanana

A self-hosted web page that mimics the Gemini "nano banana" image generation
experience. It is driven by an **OpenRouter-style (OpenAI-compatible) API**, and
your **API key is provided by you and stored only in your browser**
(`localStorage`). It works on both desktop and mobile browsers.

## How it works

- A small **Express server** (`server.js`) serves the built frontend and exposes
  `POST /proxy`, which forwards your request to the API base URL you configure.
  This avoids browser CORS issues and works with any OpenAI-compatible endpoint.
- The **API key is never stored server-side** — the browser sends it per request
  via the `Authorization` header.

## Requirements

- Node.js 20+ (developed on Node 22)

## Development

```bash
npm install
npm run dev
```

- Frontend (Vite dev server): http://localhost:5173
- Proxy (Express): http://localhost:8787 (Vite proxies `/proxy` to it)

Open http://localhost:5173, click the gear icon, and paste your OpenRouter API
key. Default model is `google/gemini-3-pro-image`; `google/gemini-3.1-flash-image`
is also available (and you can enter any custom model id).

## Production / self-hosting

```bash
npm run build   # outputs dist/
npm start       # serves dist/ + /proxy on http://localhost:8787 (set PORT to change)
```

### Docker (recommended)

The app is designed for **public hosting with per-user API keys**: each visitor
pastes their own OpenRouter or Gemini key in Settings (stored in their browser
only). The server never sees or stores keys.

```bash
docker compose up -d --build
```

By default the container listens on `127.0.0.1:8787`. Put Nginx or Caddy in
front for HTTPS. Set `proxy_read_timeout` (Nginx) or equivalent to at least
**300s** — image generation can take 20+ seconds.

Health check: `GET /healthz` → `{"ok":true}`.

#### Reverse proxy examples

**Caddy** (`banana.example.com`):

```caddy
banana.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**Nginx** (snippet):

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 300s;
    client_max_body_size 50m;
}
```

#### Visitor API configuration

| Provider | API Base URL | Model (examples) |
| -------- | ------------ | ---------------- |
| OpenRouter (default) | `https://openrouter.ai/api/v1` | `google/gemini-3-pro-image`, `google/gemini-3.1-flash-image` |
| Google Gemini (AI Studio) | `https://generativelanguage.googleapis.com/v1beta/openai` | Custom model id from [Google AI Studio](https://aistudio.google.com/) |

## Scripts

| Script          | Description                                    |
| --------------- | ---------------------------------------------- |
| `npm run dev`   | Run Vite + proxy together (hot reload)         |
| `npm run build` | Type-check and build the production bundle     |
| `npm start`     | Serve the built app + proxy (production)       |
| `npm run lint`  | ESLint + TypeScript type check                 |

## Configuration (in-app Settings)

- **API Key** — your OpenRouter (or compatible) key, stored in `localStorage`.
- **API Base URL** — defaults to `https://openrouter.ai/api/v1`.
- **Model** — image-capable model id.
