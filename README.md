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
