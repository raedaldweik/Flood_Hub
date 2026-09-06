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
   NEXT_PUBLIC_GOOGLE_MAPS_KEY=paste-your-maps-key-here
   GEMINI_API_KEY=paste-your-gemini-key-here
   ```

   Click **Update Variables**. (If you named the database service something other than
   `sadd-db`, replace that word in all four `${{...}}` references.)
3. **Settings** → **Networking** → **Public Networking** → **Generate Domain**. If it asks for
   a port, type `8000`.
4. Click **Deploy**. The first boot takes 2–3 minutes: build, wait for the database, seed it
   from the Open-Meteo archive, healthcheck green.

## Part 4 — Check it, then lock the Maps key

1. Open `https://<your-domain>/api/meta` — you should see `"database_ok": true` and counts
   for zones and alerts.
2. Open `https://<your-domain>/` — the Command Center. Press play.
3. Back in Google Cloud → **Credentials** → click your key → **Application restrictions** →
   **Websites** → add `https://<your-domain>/*` and `http://localhost:3000/*` → Save.
   Then **API restrictions** → restrict to *Maps JavaScript API* and *Map Tiles API* → Save.
   If the map goes blank after this, the website entry does not match your domain exactly.

## If something is off

- **Map shows the 2D fallback banner:** the Maps key was empty when Railway built the image.
  Set it, then Deployments → ⋮ → **Redeploy** (the key is baked in at build time).
- **"Database not seeded" or "Backend unreachable":** open `sadd-app` → Deployments → View
  logs. If it says the database is not reachable, check `DATABASE_URL` references the exact
  database service name, and that `sadd-db` is Online.
- **Re-seed from scratch:** delete the volume on `sadd-db` and redeploy both services.
- Nothing else needs setting. Do not add `PORT`, `NEXT_PUBLIC_API_BASE`, `CORS_ORIGINS`,
  `FRONTEND_DIST` or `SADD_DATA_DIR`.
