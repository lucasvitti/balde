> **Hosted 1.x setup.** The 2.x runtime listens on 127.0.0.1 only and drops proxy identity
> headers, so it does not run behind this setup as is (see the README's Quickstart).

# Deploy runbook — Balde de conhecimento → balde.example.com

Docker container behind host nginx + Authentik forward-auth (Google SSO + enforced 2FA).
Synthetic corpus only. No real data, no AI key on the box.

- **App port (localhost):** `127.0.0.1:8098`
- **Authentik outpost:** embedded, `127.0.0.1:8100`
- **Template copied:** `velas-de-oracao.lucas.mat.br` vhost
- **Project dir on VPS:** `/opt/balde` (suggested)

Run each step, confirm the ✅ check before moving on. Nothing here is destructive to other apps.

---

## 0. DNS (do first — propagation takes minutes)

Add an **A record** at the `example.com` DNS provider:

```
balde.example.com.   A   31.97.95.136
```

✅ Check (from anywhere): `dig +short balde.example.com` → `31.97.95.136`

---

## 1. Get the bundle onto the VPS → /opt/balde

Transfer `balde-deploy.tar.gz` by whatever channel reaches the box (scp from a machine that can, a private git repo, or the Hostinger file manager). Then:

```bash
sudo mkdir -p /opt/balde
sudo tar -xzf ~/balde-deploy.tar.gz -C /opt/balde
cd /opt/balde
ls demo-corpus/skills          # resumo-reuniao  classificador-chamado  test-echo
test ! -e governance/skills && echo "OK: no real corpus in bundle"
test ! -e .env.local && echo "OK: no plaintext key in bundle"
```

✅ Check: the two `OK:` lines print, and `demo-corpus/skills` lists exactly the 3 synthetic skills.

---

## 2. Confirm port 8098 is free

```bash
ss -ltnp | grep ':8098' && echo "IN USE — pick another port" || echo "OK: 8098 free"
```

✅ Check: `OK: 8098 free`. (If taken, change `8098` in `docker-compose.yml`, the Dockerfile `ENV PORT`, and the nginx `proxy_pass`.)

---

## 3. Build & run the container

```bash
cd /opt/balde
docker compose up -d --build
docker ps --filter name=balde --format '{{.Names}} | {{.Status}} | {{.Ports}}'
curl -s http://127.0.0.1:8098/api/health
```

✅ Check: container is `Up`, and `/api/health` returns `{"ok":true,...}` with `"aiMode"` NOT enabled and `"feedbackWatch":"disabled"`.

```bash
curl -s http://127.0.0.1:8098/api/skills | grep -o '"canPromote":[a-z]*' | sort | uniq -c
```
✅ Check: you see both `true` (1×, resumo-reuniao) and `false` (2×) — the gate is live.

---

## 4. Authentik — create the forward-auth application

In the Authentik admin (https://auth.lucas.mat.br):

1. **Providers → Create → Proxy Provider**
   - Name: `balde`
   - Authorization flow: your existing `default-provider-authorization-explicit-consent` (or implicit)
   - **Mode: Forward auth (single application)**
   - **External host:** `https://balde.example.com`
2. **Applications → Create**
   - Name: `Balde de conhecimento`; Slug: `balde`; Provider: `balde`
3. **Assign to the embedded outpost:** Outposts → `authentik Embedded Outpost` → Edit → add the `balde` application → Update.
4. **Restrict who gets in:** bind a group/policy to the Application (Application → *Policy / Group / User Bindings*) so only your team/you can authenticate.
5. **Enforce 2FA on this app:** ensure the authorization flow used above contains an **Authenticator Validation** stage (TOTP) with *not-configured action = deny* (or bind a require-MFA policy to the app). This forces 2FA for Balde even though TOTP is opt-in elsewhere.
   > This is the one step whose exact clicks vary by Authentik version — tell me your version and I'll give precise wording. `survey.lucas.mat.br` (also gated) is your reference for what already works.

✅ Check: the `balde` app appears on your Authentik user dashboard.

---

## 5. Install the nginx vhost (HTTP first)

```bash
sudo cp /opt/balde/deploy/nginx/balde.example.com.conf /etc/nginx/sites-available/balde.example.com
sudo ln -s /etc/nginx/sites-available/balde.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

✅ Check: `nginx -t` says *syntax is ok / test is successful*. Hitting `http://balde.example.com` now 302-redirects to Authentik.

---

## 6. TLS via certbot

```bash
sudo certbot --nginx -d balde.example.com
```
Choose redirect (option 2) when asked. Certbot rewrites the vhost to add `listen 443 ssl` + the http→https redirect.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

✅ Check: `https://balde.example.com` serves with a valid cert.

---

## 7. End-to-end verification

From a browser:
1. Open `https://balde.example.com` → redirected to Authentik.
2. Sign in with Google → prompted for 2FA → land back in Balde.
3. The 3 skills load; **Resumo de Reunião** shows ready-to-promote, **Classificador de Chamado** shows blocked.

From the VPS:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://balde.example.com            # 302 -> Authentik (unauthenticated)
curl -s -o /dev/null -w '%{http_code}\n' https://balde.example.com/api/health # 302 as well (whole app gated)
```

✅ Check: unauthenticated requests are redirected (302), never 200. The app is only reachable after SSO.

---

## Rollback / ops

- **Stop:** `cd /opt/balde && docker compose down`
- **Reset demo to clean slate:** `docker compose down -v && docker compose up -d --build`
- **Update after a code change:** re-transfer the bundle, then `docker compose up -d --build`
- **Remove the site:** `sudo rm /etc/nginx/sites-enabled/balde.example.com && sudo systemctl reload nginx`
- **Logs:** `docker logs -f balde` · nginx: `/var/log/nginx/balde-access.log`
