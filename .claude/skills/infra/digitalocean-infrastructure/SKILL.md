---
name: digitalocean-infrastructure
description: >-
  Method for hosting a docker-compose application on DigitalOcean: compose
  analysis, the service→DO offering mapping (managed vs self-hosted), sizing
  and live cost estimation, idempotent doctl provisioning order (project, VPC,
  Droplets, managed DBs, Spaces, firewalls, DNS, TLS), deployment via registry +
  compose or App Platform, the post-deploy validation checklist, and the
  deliverables under deploy/digitalocean/. Use when deploying to or estimating
  costs on DigitalOcean.
---

# DigitalOcean Infrastructure (compose → cloud)

Rule zero: **price before provision** — every recommendation carries a monthly
cost, and nothing billable is created until the user approves the costed plan.
Prices change: verify with `doctl compute size list`, `doctl databases options`,
and current DO pricing pages — never quote from memory as fact.

## 1. Prerequisites & auth

```bash
doctl auth list          # must show a valid context — else STOP:
# user runs: doctl auth init   (paste an API token with least privilege)
doctl account get        # confirms the token works + shows limits
```

## 2. Compose analysis → component inventory

Read every `docker-compose*.yml` (+ overrides, Dockerfiles, `.env.example`).
Classify each service: web app / API / worker / scheduled job / database /
cache / broker / search / object storage / reverse proxy / monitoring. For
each, note: image, ports, volumes (persistence!), depends_on, resource hints,
secrets consumed. Volumes and secrets decide what needs durable storage and a
secret store; networks decide the VPC layout.

`[TRAP]` A service that builds a **`dev` target** is a local-dev convenience, not
a deployable — the local compose stack's `frontend` service runs the Vite dev server with the
source bind-mounted. Deploy its **default/final** target (static build behind
nginx) and drop the bind mounts. Vite inlines `VITE_*` at **build** time, so
`VITE_API_URL` must be passed as a build arg with the *deployed* API URL — the
local `http://localhost:8080` baked into an image is a broken production frontend
that still looks fine until the first request.

## 3. Service → DO offering mapping

| Compose service | Production default | Budget alternative | Notes |
|---|---|---|---|
| API / web app / worker | Droplet(s) running compose | consolidate onto one Droplet | App Platform instead when: few services, no compose-only deps, hands-off ops wanted |
| SPA frontend (Vite/React) | App Platform **static site** (free tier, global CDN) | nginx container on the app Droplet | build the image's default target, never the `dev` one; `VITE_API_URL` is a build arg; needs SPA fallback to `index.html` and the API's CORS origin updated |
| PostgreSQL / MySQL | Managed Database (smallest prod plan, auto-backups) | container on the app Droplet + volume + scripted backups (dev/staging only) | never self-host prod DB without explicit user acceptance |
| Redis | Managed Valkey/Redis | container on Droplet (cache-only data) | acceptable self-hosted when data is disposable |
| RabbitMQ / Kafka | container on Droplet + volume | — | no managed offering; document ops burden |
| MinIO / S3 | **Spaces** (+ CDN) | — | S3-compatible: only endpoint + keys change |
| Elasticsearch | Managed OpenSearch | container on a dedicated Droplet | memory-hungry — never consolidate |
| Nginx / Traefik | stays as the reverse proxy on the Droplet | — | DO Load Balancer only for multi-Droplet/HA |
| Grafana/Prometheus/Loki/Tempo stack | container(s) on a small separate Droplet | same Droplet as app (small apps) | plus free DO Monitoring agent for host metrics |
| Scheduled jobs | systemd timers / cron on the Droplet, or worker containers | — | App Platform has native jobs if used |

**Compute choice**: Droplets + compose = cheapest, closest to local dev,
you patch the box. App Platform = no server ops, per-component pricing, less
compose fidelity. DOKS = only for genuine multi-node scaling needs — its
control-plane-free pricing still means ≥3 worker nodes + LB; don't default
to it.

## 4. Sizing & cost estimate

Start from the smallest size that fits the measured/declared needs (typical:
`s-1vcpu-1gb` for staging apps, `s-2vcpu-4gb` for a consolidated prod app
stack; verify live with `doctl compute size list --format Slug,Memory,VCPUs,PriceMonthly`).
Produce the cost table per environment:

```markdown
| Resource | Size/plan | $/mo | Notes/trade-off |
| app Droplet (prod) | s-2vcpu-4gb | ~$24 | API+worker+proxy consolidated |
| Managed PG (prod)  | db-s-1vcpu-1gb | ~$15 | daily backups incl. |
| Spaces             | 250GB base | ~$5 | + egress |
| **Total prod**     |  | **~$44/mo** | |
```

Cost levers: consolidate workloads where blast-radius allows; power off
non-prod when unused (`doctl compute droplet-action power-off` — note: still
billed unless snapshot+destroy); right-size volumes; skip the LB/reserved IP
until HA is real.

## 5. Provisioning order (idempotent doctl)

Scripts live in `deploy/digitalocean/` (e.g. `provision.sh` per env), each
step check-before-create, everything tagged:

```bash
# pattern: get-or-create
doctl projects list --format ID,Name | grep -q "acme-prod" || doctl projects create --name acme-prod --purpose "Web app" --environment Production
doctl vpcs list --format Name | grep -q "acme-prod" || doctl vpcs create --name acme-prod --region fra1
doctl compute ssh-key list | grep -q "deploy-key" || doctl compute ssh-key import deploy-key --public-key-file ~/.ssh/id_ed25519.pub
doctl compute droplet list --format Name | grep -q "acme-prod-app" || \
  doctl compute droplet create acme-prod-app --size s-2vcpu-4gb --image docker-20-04 \
    --region fra1 --vpc-uuid "$VPC" --ssh-keys "$KEY_ID" --enable-monitoring --enable-backups \
    --tag-names acme,prod,managed-by:doctl
doctl databases list | grep -q "acme-prod-pg" || doctl databases create acme-prod-pg --engine pg --size db-s-1vcpu-1gb --region fra1 --num-nodes 1
doctl databases firewalls append <db-id> --rule tag:acme-prod-app     # DB reachable only from app Droplets
doctl compute firewall create --name acme-prod \
  --inbound-rules "protocol:tcp,ports:443,address:0.0.0.0/0 protocol:tcp,ports:22,address:<admin-ip>/32" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0" --tag-names acme,prod
doctl compute domain create example.ge --ip-address "$DROPLET_IP"     # + records: www, api, staging
doctl registry get || doctl registry create acme --subscription-tier basic
```

Order: project → VPC → SSH key → registry → Droplets → managed DB(s) (+ DB
firewall) → Spaces (`s3cmd`/API — Spaces keys via console or API token) →
compute firewall → (LB/reserved IP if HA) → DNS → monitoring/backups. Region:
closest to the users (e.g. `fra1` for Georgia) — same region for everything.

## 6. Deployment

1. **Images**: build from the repo's Dockerfiles, push to DO registry
   (`doctl registry login`, tag `registry.digitalocean.com/<reg>/<svc>:<sha>`).
2. **Compose for prod**: a `deploy/digitalocean/docker-compose.prod.yml` —
   registry images, no build contexts, env from `/etc/acme/.env` on the
   Droplet (never committed), managed-service URLs replacing local containers.
3. **Bring up over SSH**: `docker compose pull && docker compose up -d`,
   reverse proxy (nginx/Traefik or Caddy) terminating TLS via Let's Encrypt
   (HTTP-01 needs DNS live first), HTTP→HTTPS redirect.
4. **App Platform path** instead: `deploy/digitalocean/app.yaml` spec +
   `doctl apps create --spec`, secrets as `type: SECRET` envs.

## 7. Post-deploy validation

- [ ] `docker compose ps` — all services healthy/running, restarts stable
- [ ] Health endpoints 200 from outside (`curl https://api.example.ge/health`)
- [ ] DB reachable from app only — connection test from Droplet; blocked from public
- [ ] Worker processes a real job; queue depth drains
- [ ] TLS valid (issuer, expiry, chain) + redirect; DNS resolves to the right IP
- [ ] Firewall: only 443 (+ restricted 22) inbound answers
- [ ] Monitoring shows the host + alerts route; backups enabled and scheduled
- [ ] Logs flowing (`docker compose logs`, DO monitoring)

## 8. Deliverables (`deploy/digitalocean/`)

```text
deploy/digitalocean/
├── ASSESSMENT.md         # component inventory, recommendation + trade-offs, cost tables per env
├── provision-<env>.sh    # idempotent doctl sequence
├── docker-compose.prod.yml  (or app.yaml)
├── .env.example          # every required secret/var, placeholder values only
├── DEPLOY.md             # step-by-step deploy + rollback
└── RUNBOOK.md            # operations: logs, restart, scale up a size, restore a backup, rotate secrets, teardown
```

Success = app fully operational on its domain, costs optimized and known,
security defaults applied, recreatable from the repo alone.
