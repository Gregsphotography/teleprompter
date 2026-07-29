# AeroPrompter visitor counter

A ~200-line Node service that counts visitors to aeroprompter.app. It runs on
our own EU server, writes to a SQLite file that is not reachable from the web,
and involves no third party at any point.

It exists to answer one question — *how many people use this?* — without
sending anything to Google, Vercel Analytics, or any hosted platform.

It runs on the same Hetzner box that serves the site, reached through two nginx
`location` blocks, so the beacon is same-origin with aeroprompter.app. No
subdomain, no DNS change, no CORS, no CSP change.

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

No DNS changes and no new subdomain: the tracker runs on the same Hetzner box
that already serves aeroprompter.app, and nginx proxies two paths to it. That
makes the beacon same-origin, so there is no CORS, no preflight, and no CSP
change.

1. **Create the service account and copy the files:**

   ```sh
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin aeroprompter
   sudo mkdir -p /opt/aeroprompter-tracker
   sudo cp tracker/server.mjs tracker/stats.mjs /opt/aeroprompter-tracker/
   ```

2. **Configure:**

   ```sh
   sudo cp tracker/.env.example /etc/aeroprompter-tracker.env
   sudo chmod 600 /etc/aeroprompter-tracker.env
   sudoedit /etc/aeroprompter-tracker.env
   ```

3. **Install the unit:**

   ```sh
   sudo cp tracker/aeroprompter-tracker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now aeroprompter-tracker
   systemctl status aeroprompter-tracker
   ```

   `StateDirectory=aeroprompter` makes systemd create `/var/lib/aeroprompter`
   owned by the `aeroprompter` user with mode `0700`. No other service on the
   box can read the database, and you reach it with `sudo -u aeroprompter`.

4. **Set the dashboard password:**

   ```sh
   sudo apt install apache2-utils                      # provides htpasswd
   sudo htpasswd -c /etc/nginx/aeroprompter-stats.htpasswd greg
   sudo chown www-data:www-data /etc/nginx/aeroprompter-stats.htpasswd
   sudo chmod 640 /etc/nginx/aeroprompter-stats.htpasswd
   ```

   Use whatever username you like in place of `greg` and update
   `nginx.example.conf` to match if you change the file path.

5. **Add the nginx routes** — in Forge, open the aeroprompter.app site →
   **Edit Files → Edit Nginx Configuration**, paste the contents of
   `tracker/nginx.example.conf` inside the existing `server { … }` block, and
   save. Forge reloads nginx for you.

   Both locations use `=` (exact match), which in nginx beats any prefix
   location, so an existing `location /api/` or `location /` cannot shadow
   them.

6. **Verify:**

   ```sh
   ss -lntp | grep 8787                                 # -> 127.0.0.1:8787 only
   sudo ls -l /var/lib/aeroprompter/hits.db             # -> -rw-------
   curl -i https://aeroprompter.app/stats               # -> 401 before credentials
   curl -s -o /dev/null -w '%{http_code}\n' \
     -X POST https://aeroprompter.app/api/hit \
     -H 'Content-Type: text/plain' -d '{"path":"/"}'    # -> 204
   ```

   Then load https://aeroprompter.app in a browser and check the count went up.

## Reading the numbers

### In a browser

<https://aeroprompter.app/stats>, behind HTTP basic auth — your browser will
prompt for the username and password from step 4. It's a browser popup, not a
login form. Summary cards (today / 7 days / 30 days / all time), a 30-day
chart, and top pages and referrers. Works on a phone.

The page is server-rendered and fully self-contained: no scripts, no external
requests, no fonts, `Cache-Control: no-store`, `noindex`, and a
`default-src 'none'` CSP. The database is never exposed — only these rendered
numbers are. Values coming from visitors' browsers (paths, referrer hosts) are
HTML-escaped on the way out.

To change the password later, re-run `htpasswd` without `-c` (which would
overwrite the file):

```sh
sudo htpasswd /etc/nginx/aeroprompter-stats.htpasswd greg
```

The credentials live in `/etc/nginx/aeroprompter-stats.htpasswd` on the server,
never in this repository.

### On the command line

The database lives at `/var/lib/aeroprompter/hits.db`, owned by the
`aeroprompter` user with mode `0700` on the directory. It is not served by
nginx and not reachable over HTTP. SSH to the server, then:

```sh
sudo -u aeroprompter node /opt/aeroprompter-tracker/stats.mjs
```

`stats.mjs` defaults to `/var/lib/aeroprompter/hits.db`, so no environment
variable is needed. `sudo node …` as root works too.

```
node stats.mjs              # last 30 days: visitors + pageviews per day
node stats.mjs --days 90    # longer window
node stats.mjs --total      # all-time totals
node stats.mjs --paths      # most visited paths
node stats.mjs --referrers  # where visitors came from
```

Add a shell alias so you never have to remember the path:

```sh
echo "alias aerostats='sudo -u aeroprompter node /opt/aeroprompter-tracker/stats.mjs'" \
  >> ~/.bashrc
```

### Ad-hoc SQL

`stats.mjs` is read-only and covers the usual questions, but the file is a
plain SQLite database — query it however you like. The examples below use the
`sqlite3` CLI, which is not installed by default (`sudo apt install sqlite3`);
the tracker itself does not need it.

```sh
sudo -u aeroprompter sqlite3 /var/lib/aeroprompter/hits.db \
  "SELECT day, COUNT(DISTINCT visitor) FROM hits GROUP BY day ORDER BY day DESC LIMIT 7;"
```

Open it read-only if you just want to look, so a stray `UPDATE` can't touch the
data:

```sh
sudo -u aeroprompter sqlite3 -readonly /var/lib/aeroprompter/hits.db
```

### Pulling a copy to your laptop

The database is in WAL mode, so take a consistent snapshot with `.backup`
rather than `cp` — a plain copy can catch a torn write:

```sh
ssh you@server "sudo -u aeroprompter sqlite3 /var/lib/aeroprompter/hits.db \
  \".backup /tmp/hits-snapshot.db\" && sudo chown \$USER /tmp/hits-snapshot.db"
scp you@server:/tmp/hits-snapshot.db .
ssh you@server "rm /tmp/hits-snapshot.db"
node tracker/stats.mjs   # with TRACKER_DB=./hits-snapshot.db
```

Remember the snapshot is a second copy of the data — delete it when you're
done rather than leaving it in Downloads.

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

Stop the service, remove the two `location` blocks from the nginx config,
delete `/var/lib/aeroprompter` and the htpasswd file, then remove the
`initAnalytics()` call in `public/app.js` and the visitor-counting paragraphs in
`public/privacy.html` and `public/cookie-policy.html`. No CSP change to undo.
