# AeroPrompter visitor counter

A small Node service that counts visitors to aeroprompter.app. It runs on our
own EU server, appends to a CSV file that is not reachable from the web, and
involves no third party at any point.

It exists to answer one question — *how many people use this?* — without
sending anything to Google, Vercel Analytics, or any hosted platform.

It runs on the same Hetzner box that serves the site, reached through two nginx
`location` blocks, so the beacon is same-origin with aeroprompter.app. No
subdomain, no DNS change, no CORS, no CSP change.

## What it stores

One append-only CSV file at `/var/lib/aeroprompter/hits.csv`:

```
date,time,visitor,path,referrer
2026-07-29,11:08:36,823e79efbbfa4588,/,
2026-07-29,11:08:36,823e79efbbfa4588,/privacy.html,
2026-07-29,11:08:51,d08060ed459c77ea,/,news.ycombinator.com
```

No database, no schema, no migrations. Open it in a spreadsheet, `grep` it,
`wc -l` it, delete it. Every field is validated before being written and none
can contain a comma, quote or newline, so it never needs quoting and a plain
`split(',')` always works.

**No IP address is stored.** `visitor` is a hash of the address, the browser's
user agent, and a random salt that changes every UTC day. The salt lives in
`salt.json` next to the CSV and is *overwritten* at the day boundary — so the
moment a new day starts, the previous day's hashes can no longer be linked to
any address by anyone, including us. There is no retention policy to remember,
because there is nothing left to expire.

That gives an honest unique-visitor count per day while leaving no personal
data at rest — which is why the app needs no cookie banner and the privacy
policy needs only a short paragraph.

Because the hash is per-day by design, a visitor returning on three days counts
as three "visitor-days". There is deliberately no way to follow someone across
days; that is the point.

### Counting it yourself

The whole point of a CSV is that you don't need the tooling:

```sh
wc -l < hits.csv                                    # total pageviews (+1 header)
cut -d, -f3 hits.csv | tail -n +2 | sort -u | wc -l # unique visitors
grep ^2026-07-29 hits.csv | wc -l                   # pageviews on one day
```

## Requirements

Node 16 or newer. No npm dependencies and no database — nothing to install,
nothing to keep patched. (An earlier version needed Node 22.5+ for the built-in
SQLite module; switching to CSV removed that requirement.)

## Deploying

One command on the server:

```sh
cd /home/forge/aeroprompter.app        # wherever Forge checked the repo out
sudo bash tracker/install.sh
```

It checks prerequisites, creates the service account, installs the files and
the systemd unit, starts the service, prompts for a dashboard password, and
writes an nginx snippet. Safe to re-run — it will not reset your password or
overwrite your config.

Then **one line** in Forge (aeroprompter.app → Edit Files → Edit Nginx
Configuration), inside the existing `server { ... }` block:

```nginx
include /etc/nginx/aeroprompter-tracker.conf;
```

Save; Forge reloads nginx. Done — <https://aeroprompter.app/stats>.

### If the installer stops

It fails loudly with the reason rather than half-installing. The most common
one by far:

**"Node X is too old"** — needs Node 16+. Fix:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

**"Node is not installed, or not on root's PATH"** — Forge installs Node for
the deploy user, not always for root:

```sh
sudo ln -s $(which node) /usr/bin/node
```

Anything else: `journalctl -u aeroprompter-tracker -n 30`

## Reading the numbers

### In a browser

<https://aeroprompter.app/stats>, behind HTTP basic auth — your browser will
prompt for the username and password the installer asked you to choose. It's a
browser popup, not a login form. Summary cards (today / 7 days / 30 days / all time), a 30-day
chart, and top pages and referrers. Works on a phone.

The page is server-rendered and fully self-contained: no scripts, no external
requests, no fonts, `Cache-Control: no-store`, `noindex`, and a
`default-src 'none'` CSP. The CSV is never exposed — only these rendered
numbers are. Values coming from visitors' browsers (paths, referrer hosts) are
HTML-escaped on the way out.

To change the password later, delete the file and re-run the installer:

```sh
sudo rm /etc/nginx/aeroprompter-stats.htpasswd
sudo bash tracker/install.sh
```

The credentials live in `/etc/nginx/aeroprompter-stats.htpasswd` on the server,
never in this repository.

### On the command line

The CSV lives at `/var/lib/aeroprompter/hits.csv`, owned by the `aeroprompter`
user with mode `0700` on the directory. It is not served by nginx and not
reachable over HTTP. SSH to the server, then:

```sh
sudo -u aeroprompter node /opt/aeroprompter-tracker/stats.mjs
```

`stats.mjs` defaults to `/var/lib/aeroprompter/hits.csv`, so no environment
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

### Taking a copy

It's a text file — just copy it:

```sh
scp you@server:/var/lib/aeroprompter/hits.csv .
```

(You may need `sudo cat` into a readable location first, since the directory is
`0700`.) Remember the copy is a second copy of the data; delete it when done.

## Backups

Append-only text, a few hundred KB per year at modest traffic. `cp` is a
perfectly safe backup — there is no write-ahead log or locking to worry about.

## Storing raw IPs

Setting `TRACKER_STORE_RAW_IP=1` writes the raw address into `visitor` instead
of a hash. Before doing that, be aware of what changes:

- IP addresses are personal data under the GDPR and the revised Swiss FADP,
  even in a private file on your own server.
- You become responsible for a defined retention period and for deleting rows
  once they expire. The daily salt rotation no longer protects you, because no
  salt is involved.
- The privacy policy must say you store IP addresses, for how long, and on what
  legal basis. The current wording in `public/privacy.html` describes the
  hashing behaviour and would become inaccurate.
- Data-subject requests (access, deletion) become answerable and therefore
  obligatory, because the data is now linkable to an individual.

The hashed default answers "how many people use this" exactly as accurately.
The only thing raw IPs add is the ability to identify individuals, which is the
part that carries the obligations.

## Removing it

Remove the `include` line from the nginx config, then:

```sh
sudo systemctl disable --now aeroprompter-tracker
sudo rm -rf /opt/aeroprompter-tracker /var/lib/aeroprompter \
  /etc/aeroprompter-tracker.env /etc/systemd/system/aeroprompter-tracker.service \
  /etc/nginx/aeroprompter-tracker.conf /etc/nginx/aeroprompter-stats.htpasswd
sudo userdel aeroprompter
```

Then in this repo, remove the `initAnalytics()` call in `public/app.js` and the
visitor-counting paragraphs in `public/privacy.html` and
`public/cookie-policy.html`. There is no CSP change to undo.
