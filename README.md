# Cat Tracker

A small app for tracking cat feedings, weight, and status. React/Vite/Mantine client backed by an Express + SQLite server.

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
```

This installs dependencies for the root workspace, `server`, and `client`.

## Development

Run the server and client dev servers in two separate terminals:

```bash
npm run dev:server   # Express API on http://localhost:3000
npm run dev:client   # Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://localhost:3000`, so the client can be used at `http://localhost:5173` with no extra config.

Seed the database with sample data (optional):

```bash
npm run seed
```

## Tests

```bash
npm test                          # server tests (vitest)
npm run test --workspace client   # client tests (vitest + Testing Library)
```

## Production

Build the client and start the server, which serves the built client as static files and answers `/api/*` requests from the same port:

```bash
npm run build
npm start
```

The server listens on `0.0.0.0:3000`, so it's reachable from other devices on your network, not just `localhost`.

### Accessing it from your phone over your private WiFi

1. Make sure your Mac and your phone are connected to the **same WiFi network** (not a guest network, which usually isolates devices from each other).
2. Find your Mac's local IP address:
   ```bash
   ipconfig getifaddr en0
   ```
   (If you're on WiFi via a different interface, or this returns nothing, check **System Settings → Wi-Fi → Details… → TCP/IP** for the IP address instead.)
3. With the server running (`npm start`), open a browser on your phone and go to:
   ```
   http://<your-mac-ip>:3000
   ```
   e.g. `http://192.168.1.18:3000`
4. If it doesn't load, macOS may be blocking incoming connections. The first time the server binds to the network, macOS usually prompts **"Do you want the application 'node' to accept incoming network connections?"** — click **Allow**. You can also check **System Settings → Network → Firewall** if you don't see that prompt.

Notes:
- Your Mac's local IP can change (e.g. after reconnecting to WiFi or a router restart). Re-run the `ipconfig getifaddr en0` command if the phone can no longer reach it.
- As an alternative to the IP address, try `http://<your-mac-hostname>.local:3000` (find the hostname in **System Settings → General → Sharing**).

#### Live-reloading dev mode over WiFi (optional)

If you want hot-reload while testing on your phone instead of a full production build, expose the Vite dev server on your network too:

```bash
npm run dev:server                 # terminal 1
npm run dev:client -- --host       # terminal 2
```

Then visit `http://<your-mac-ip>:5173` on your phone. The Vite proxy still forwards `/api` calls to `localhost:3000` on your Mac (that proxying happens server-side in the Vite process, not in your phone's browser), so this works without any additional config.
