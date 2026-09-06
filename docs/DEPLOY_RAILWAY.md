# Deploying PROJECT SADD on Railway — step by step

You need two things you may not have yet: a **Google Maps key** (for the 3D map) and a
**Railway project with two services**. The Gemini key is only used from Phase 3, but you can
set it now. Follow the steps in order.

## Part 1 — Get the Google Maps key (10 minutes)

1. Open <https://console.cloud.google.com> and sign in with a Google account.
2. Top-left, click the project picker → **New Project** → name it `sadd-demo` → **Create**.
   Make sure `sadd-demo` is now selected in the picker.
3. Left menu ☰ → **Billing** → **Link a billing account** → add a card. Google's free monthly
   usage covers a demo many times over, but a card must be on file or the map will not load.
4. Left menu ☰ → **APIs & Services** → **Library**. Search **Maps JavaScript API** → **Enable**.
   Go back to the Library, search **Map Tiles API** → **Enable**. (Both are required for
   photorealistic 3D.)
5. Left menu ☰ → **APIs & Services** → **Credentials** → **+ Create credentials** → **API key**.
   Copy the key somewhere safe. This is `NEXT_PUBLIC_GOOGLE_MAPS_KEY`.
6. Skip restrictions for now. After Part 3 you will come back and restrict it (Part 4).

## Part 2 — The database service

1. Open your Railway project. Click **+ Create** (top right) → **GitHub Repo** → `Flood_Hub`.
   A second card appears. Ignore the deploy it starts.
2. Click the new card → **Settings** tab. Change the service name at the top to **`sadd-db`**.
3. Still in Settings → **Source** → **Root Directory** → type `docker/postgres` → confirm.
4. Right-click the `sadd-db` card on the canvas → **Attach Volume** (or **+ Create → Volume**
   and pick `sadd-db`). Mount path: `/var/lib/postgresql/data`.
5. **Variables** tab → **Raw Editor** → paste these three lines, using your own long password
   made of letters and digits only (no symbols — it is embedded in a URL):

   ```
   POSTGRES_USER=sadd
   POSTGRES_PASSWORD=ChangeMeToALongRandomPassword123
   POSTGRES_DB=sadd
   ```

   Click **Update Variables**.
6. Click the purple **Deploy** button that appears at the top of the canvas. Wait until the
   card shows **Online / Active**.

## Part 3 — The app service (the card Railway made when you first deployed)

1. Click the `Flood_Hub` card → **Settings** → rename it **`sadd-app`**. Leave Root Directory
   empty. Under **Source** confirm the branch is the one with the code
   (`claude/project-sadd-flood-twin-gaywht` unless you merged it).
2. **Variables** tab. **Ignore the "Suggested Variables" list** — do not click Add on it.
   Open the **Raw Editor** and paste exactly this, filling in your two keys:

   ```
   DATABASE_URL=postgresql://${{sadd-db.POSTGRES_USER}}:${{sadd-db.POSTGRES_PASSWORD}}@${{sadd-db.RAILWAY_PRIVATE_DOMAIN}}:5432/${{sadd-db.POSTGRES_DB}}
   SEED_ON_STARTUP=true
   PORT=8000
   NEXT_PUBLIC_GOOGLE_MAPS_KEY=paste-your-maps-key-here
   GEMINI_API_KEY=paste-your-gemini-key-here
   ```

   Click **Update Variables**. (If you named the database service something other than
   `sadd-db`, replace that word in all four `${{...}}` references.) `PORT=8000` pins the port
   the app listens on so it always matches the domain you create next.
3. **Settings** → **Networking** → **Public Networking** → **Generate Domain**. When it asks for
   a port, type `8000`. The domain card must then read **Port 8000** — if it shows any other
   number, click the pencil icon on the card and change it to 8000.
4. Click **Deploy**. The build takes 2–3 minutes. The app answers on its URL as soon as the
   container starts; on the very first boot it spends about a minute more waiting for the
   database and seeding the replay, and the page shows that progress live.

## Part 4 — Check it, then lock the Maps key

1. Open `https://<your-domain>/api/health` — you should see `"startup": {"phase": "ready"`.
   On the first boot it may say `"seeding"` for a minute; refresh until it reads `ready`.
2. Open `https://<your-domain>/api/meta` — `"database_ok": true` and counts for zones and alerts.
3. Open `https://<your-domain>/` — the Command Center. Press play.
4. Back in Google Cloud → **Credentials** → click your key → **Application restrictions** →
   **Websites** → add `https://<your-domain>/*` and `http://localhost:3000/*` → Save.
   Then **API restrictions** → restrict to *Maps JavaScript API* and *Map Tiles API* → Save.
   If the map goes blank after this, the website entry does not match your domain exactly.

## If something is off

- **Railway's own page says "Application failed to respond":** nothing was listening on the
  port Railway forwards to. Check two things on `sadd-app`:
  1. **Settings → Networking**: the domain card must read **Port 8000**, and **Variables** must
     contain `PORT=8000`. Fix either, then Deploy.
  2. **Deployments → latest → View logs**: the last lines should include
     `Uvicorn running on http://0.0.0.0:8000` (that number must be 8000) and
     `[sadd] startup: ready`. If instead it repeats `[sadd] startup: waiting_db`, the app is up
     but cannot reach the database — check `DATABASE_URL` and that `sadd-db` is Online.
     If it shows `[sadd] startup: seed_failed`, the traceback right above it says why.
- **The page says "Warming up the twin":** normal on the first boot — the database is being
  seeded from the Open-Meteo archive. It clears by itself in about a minute.
- **The map is satellite imagery but looks flat, not 3D:** this is expected in Qatar. Google's
  Photorealistic 3D Tiles (the building mesh) do not cover Doha — verified on a live key:
  flat imagery at every range, both APIs enabled, no Map Tiles errors in the console. The map
  is Google's 3D engine drawing satellite imagery on terrain, which is why the small pill on
  the map says so. Keep the camera 4 km or higher (the **Bay view** button does) where the
  oblique imagery still looks good. The same `Map3DElement` will show the mesh with no code
  change on the day Google adds Qatar. If you *do* see an error mentioning "Map Tiles API"
  in F12 → Console, that API is disabled or blocked by the key's restrictions — fix that
  first.
- **No towers on the 3D map:** the building volume is OpenStreetMap data fetched during the
  Docker build (`[buildings] wrote N towers` in the build log). If that line says `failed`,
  the Overpass API was busy — Deployments → ⋮ → **Redeploy** to fetch again. The pill on the
  map shows the tower count and lets you switch the layer off if it ever stutters over
  screen share.
- **Map shows the 2D fallback banner:** the Maps key was empty when Railway built the image.
  Set it, then Deployments → ⋮ → **Redeploy** (the key is baked in at build time).
- **"Database not seeded" or "Backend unreachable":** open `sadd-app` → Deployments → View
  logs. If it says the database is not reachable, check `DATABASE_URL` references the exact
  database service name, and that `sadd-db` is Online.
- **Re-seed from scratch:** delete the volume on `sadd-db` and redeploy both services.
- Nothing else needs setting. Do not add `NEXT_PUBLIC_API_BASE`, `CORS_ORIGINS`,
  `FRONTEND_DIST` or `SADD_DATA_DIR`.
