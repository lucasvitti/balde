# Runbook — nginx hardening (HSTS + rate limiting)

Two quick wins for `balde.example.com`, applied on the VPS. Both are
edits to the **live, certbot-managed** nginx config (the repo vhost is the :80
source; certbot added the :443 block on the box). Backup → edit → `nginx -t` →
reload → verify → rollback-on-failure.

Run as your VPS user (uses `sudo`).

## 1. Backup

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp /etc/nginx/sites-available/balde.example.com ~/balde-vhost-bak-$STAMP.conf
echo "backup: ~/balde-vhost-bak-$STAMP.conf"
```

## 2. Rate-limit zone (http context, via conf.d)

```bash
sudo tee /etc/nginx/conf.d/balde-ratelimit.conf >/dev/null <<'EOF'
limit_req_zone $binary_remote_addr zone=balde_api:10m rate=10r/s;
EOF
```

## 3. Apply `limit_req` to /api/v1 + HSTS to the 443 block

```bash
sudo nano /etc/nginx/sites-available/balde.example.com
```

**a) In the `location /api/v1/ { … }` block (the one inside the `listen 443` server), add at the top:**

```nginx
        limit_req        zone=balde_api burst=20 nodelay;
        limit_req_status 429;
```

**b) In the `server { … listen 443 … }` block, add one line (near the other `add_header`/ssl lines):**

```nginx
        add_header Strict-Transport-Security "max-age=63072000" always;
```

> HSTS caveat: browsers cache this for `max-age` (2 years here) and force HTTPS —
> hard to undo. Add `; includeSubDomains` **only** if every `*.example.com`
> is HTTPS (revhub.* is; check any others first). To disable later: set
> `max-age=0`, reload, and revisits clear it.

## 4. Validate + reload

```bash
sudo nginx -t && sudo systemctl reload nginx
```

If `nginx -t` fails, do **not** reload — jump to Rollback.

## 5. Verify

```bash
# HSTS header present:
curl -sI https://balde.example.com | grep -i strict-transport-security

# Rate limit trips to 429 under a burst (no key -> 401 until the limiter kicks in):
for i in $(seq 1 40); do
  curl -s -o /dev/null -w "%{http_code} " https://balde.example.com/api/v1/skills
done; echo
# expect: a run of 401s, then 429s once >~30 in the burst window
```

## 6. Rollback (only if step 4 or 5 fails)

```bash
sudo cp ~/balde-vhost-bak-<STAMP>.conf /etc/nginx/sites-available/balde.example.com
sudo rm -f /etc/nginx/conf.d/balde-ratelimit.conf
sudo nginx -t && sudo systemctl reload nginx
```

Nothing here touches the Balde container, the corpus, or Authentik — it is purely
the nginx edge, fully reversible via the backup.
