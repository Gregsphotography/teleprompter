# AeroPrompter visitor counter

A ~200-line Node service that counts visitors to aeroprompter.app. It runs on
our own EU server, writes to a SQLite file that is not reachable from the web,
and involves no third party at any point.

It exists to answer one question — *how many people use this?* — without
sending anything to Vercel Analytics, Google, or any hosted platform.

## What it stores

Each hit becomes one row:

| Column | Example | Notes |
| --- | --- | --- |
| `day` | `2026-07-29` | UTC |
| `visitor` | `4cd52592…` | `sha256(daily salt ‖ ip ‖ user-agent)`, truncated |
| `path` | `/privacy.html` | validated against a strict pattern |
| `referrer_host` | `news.ycombinator.com` | hostname only, never a full URL |
| `created_at` | `1769644800000` | epoch ms |

**No IP address is stored.** The salt is 32 random bytes generated on the first
hit of each UTC day and deleted after two days. Once a day's salt is gone, that
day's hashes cannot be linked back to any address by anyone, including us.

That gives an honest unique-visitor count per day while leaving no personal
data at rest — which is why the app needs no cookie banner and the privacy
policy needs only a short paragraph.

Because the hash is per-day by design, a visitor returning on three days counts
as three "visitor-days". There is deliberately no way to follow someone across
days; that is the point.

## Requirements

Node 22.5+ (uses the built-in `node:sqlite`). No npm dependencies — nothing to
install, nothing to keep patched. Node 22 prints an experimental warning for
`node:sqlite`; Node 24 does not.

## Deploying

1. **DNS** — point `stats.aeroprompter.app` at the server.

2. **Copy the service:**

   ```sh
   sudo mkdir -p /opt/aeroprompter-tracker
   sudo cp tracker/server.mjs tracker/stats.mjs /opt/aeroprompter-tracker/
   ```

3. **Configure:**

   ```sh
   sudo cp tracker/.env.example /etc/aeroprompter-tracker.env
   sudo chmod 600 /etc/aeroprompter-tracker.env
   sudoedit /etc/aeroprompter-tracker.env
   ```

4. **Install the unit:**

   ```sh
   sudo cp tracker/aeroprompter-tracker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now aeroprompter-tracker
   systemctl status aeroprompter-tracker
   ```

   `DynamicUser=yes` plus `StateDirectory=aeroprompter` means systemd creates
   `/var/lib/aeroprompter` owned by a transient unprivileged user. No other
   service on the box can read the database.

5. **Front it with Caddy** — append `tracker/Caddyfile.example` to
   `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. Caddy handles
   TLS, sets `X-Forwarded-For`, and exposes only `/hit` and `/health`.

6. **Verify:**

   ```sh
   curl https://stats.aeroprompter.app/health          # -> ok
   ss -lntp | grep 8787                                # -> 127.0.0.1:8787 only
   sudo ls -l /var/lib/aeroprompter/hits.db            # -> -rw-------
   ```

   Then load https://aeroprompter.app in a browser and check a row appeared.

## Reading the numbers

Over SSH, on the server. This is the only way to read the data.

```sh
sudo -u $(systemctl show -p User --value aeroprompter-tracker) \
  TRACKER_DB=/var/lib/aeroprompter/hits.db \
  node /opt/aeroprompter-tracker/stats.mjs
```

```
node stats.mjs              # last 30 days: visitors + pageviews per day
node stats.mjs --days 90    # longer window
node stats.mjs --total      # all-time totals
node stats.mjs --paths      # most visited paths
node stats.mjs --referrers  # where visitors came from
```

## Backups

The database is small — a few hundred KB per year at modest traffic. It runs in
WAL mode, so copy it with `sqlite3 hits.db ".backup /path/to/backup.db"` rather
than `cp`, which can catch a torn write.

## Storing raw IPs

Setting `TRACKER_STORE_RAW_IP=1` writes the raw address into `visitor` instead
of a hash. Before doing that, be aware of what changes:

- IP addresses are personal data under the GDPR and the revised Swiss FADP,
  even in a private file on your own server.
- You become responsible for a defined retention period and for deleting data
  once it expires. The automatic salt rotation no longer protects you, because
  there is no salt involved.
- The privacy policy must say you store IP addresses, for how long, and on what
  legal basis. The current wording in `public/privacy.html` describes the
  hashing behaviour and would become inaccurate.
- Data-subject requests (access, deletion) become answerable and therefore
  obligatory, because the data is now linkable to an individual.

The hashed default answers "how many people use this" exactly as accurately.
The only thing raw IPs add is the ability to identify individuals, which is the
part that carries the obligations.

## Removing it

Stop the service, drop the Caddy block, delete `/var/lib/aeroprompter`, then
remove the `initAnalytics()` call in `public/app.js`, the `connect-src` entry in
`vercel.json`, and the visitor-counting paragraphs in `public/privacy.html` and
`public/cookie-policy.html`.
