---
name: release-pipeline
description: >-
  Version-driven GitHub Actions release engineering: discovery, semantic
  versioning via Conventional Commits, the four-workflow architecture (ci /
  release / deploy / rollback), caching and parallelization, security scanning
  + SBOM, GitHub Environments with approvals, deployment strategies, tested
  rollback, notifications, and the secrets/variables + runbook documentation.
  Use when setting up or improving CI/CD, release, or deployment automation.
---

# Release Pipeline (version-driven CI/CD on GitHub Actions)

Rule zero: **a deployment happens because a version was cut** — tag/release
triggers CD; branch pushes only ever trigger CI. Dockerfiles + the minimal
build pipeline live in `containerization-cicd`; this skill turns that into the
full release flow (replace the basic pipeline — never leave two competing ones).

## 1. Discovery

Inventory before wiring: languages/stacks (`*.sln`, `package.json`), test
projects and how they run, Dockerfiles + compose files, existing
`.github/workflows/`, deployment target (`deploy/digitalocean/` scripts, App
Platform spec, k8s manifests), health endpoints, migration strategy. Report
gaps (no tests, no HEALTHCHECK, no /health route, secrets in compose) as
findings to fix first — the pipeline can't gate on what doesn't exist.

## 2. Versioning strategy

Default recommendation: **Conventional Commits → automated semver**.
`fix:`→patch, `feat:`→minor, `BREAKING CHANGE`/`!`→major. The release workflow
computes the next version, updates the changelog, creates annotated tag
`vX.Y.Z` + GitHub Release. Alternatives when the team prefers: manual
`workflow_dispatch` with a `major|minor|patch` choice, or hand-pushed tags.
Either way the **tag is the single deployment trigger** and images are tagged
with both the semver and the commit SHA.

## 3. Workflow architecture

```text
.github/workflows/
├── ci.yml        # PR + push: validate → build → analyze → test → scan   (no deploy)
├── release.yml   # main only: compute version → changelog → tag → GitHub Release
├── deploy.yml    # on: release published / tag v*: images → staging → approval → production
└── rollback.yml  # workflow_dispatch(version): redeploy that version's images
```

Shared logic → reusable workflows (`workflow_call`) or composite actions;
never copy-paste jobs between files.

### ci.yml essentials
```yaml
permissions: { contents: read }            # least privilege per workflow
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  backend:                                  # parallel with frontend job
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: actions/setup-dotnet@<pinned-sha>
        with: { dotnet-version: 10.x, cache: true }
      - run: dotnet restore && dotnet build -c Release --no-restore
      - run: dotnet format --verify-no-changes
      - run: dotnet test -c Release --no-build --logger trx
  frontend:
    steps:
      - uses: actions/setup-node@<pinned-sha>
        with: { node-version: 22, cache: npm }
      - run: npm ci && npm run lint && npx tsc --noEmit && npm test -- --run && npm run build
  security:
    steps:
      - run: gitleaks detect --no-banner    # secret scan
      - run: dotnet list package --vulnerable --include-transitive
      - run: npm audit --audit-level=high
```
Pin every third-party action to a commit SHA. Fail fast: validation and cheap
checks run before expensive ones; a red job stops the chain. Path filters
(`paths:`) skip stacks a change can't affect; in monorepos build only affected
projects where tooling allows.

### deploy.yml essentials
```yaml
on: { release: { types: [published] } }
permissions: { contents: read, packages: write }
jobs:
  images:      # build once, deploy everywhere — the artifact is immutable
    steps:
      - run: docker build -t $REG/api:${VERSION} -t $REG/api:${SHA} --label org.opencontainers.image.version=${VERSION} .
      - run: trivy image --exit-code 1 --severity HIGH,CRITICAL $REG/api:${VERSION}
      - uses: anchore/sbom-action@<pinned-sha>          # SBOM published with the release
      - run: docker push --all-tags $REG/api
  staging:
    needs: images
    environment: staging                                 # env-scoped secrets
    steps: [deploy, health-check]
  production:
    needs: staging
    environment: production                              # required reviewers gate here
    concurrency: { group: deploy-production }            # never two deploys at once
    steps: [deploy, health-check, notify]
```
Health check pattern: poll `https://<host>/health` until 200 (bounded retries);
on failure the job fails loudly and the summary links `rollback.yml` with the
previous version pre-filled. Upload test reports/coverage as artifacts;
release notes from the changelog.

## 4. Deployment strategy

| Infrastructure | Strategy |
|---|---|
| Single Droplet + compose (default here) | **recreate with health gate**: `docker compose pull && up -d`, poll health, previous images remain in the registry for instant rollback |
| Load balancer + ≥2 hosts | rolling (drain → update → verify, one host at a time) or blue-green (switch LB target) |
| Canary | only with real traffic splitting (LB weights/k8s) — don't fake it |

Recommend the simplest strategy the infra supports; state the downtime
implication honestly.

## 5. GitHub configuration (scripted via `gh`)

- **Environments** per target with protection rules:
  `gh api repos/{owner}/{repo}/environments/production -X PUT -f ...`
  (required reviewers for production, wait timer optional).
- **Branch protection** on `main`: required status checks = the CI jobs,
  required PR review, no force push.
- **Secrets/variables**: `gh secret set --env production DO_SSH_KEY < key`,
  `gh variable set --env staging API_URL ...` — documented in
  `deploy/cicd/SECRETS.md` (name, purpose, environment, who provisions it);
  values never in the repo.

## 6. Rollback

`rollback.yml` takes a version input, verifies the image tags exist in the
registry, redeploys them (same mechanism as deploy — no special path), health
checks, notifies. Database migrations: prefer **roll-forward** (new fix
version); automated schema rollback only when migrations are verified
reversible — say which applies in the runbook. Test the rollback once for
real (or via a staging drill) before calling the pipeline done.

## 7. Notifications

Deployment/rollback results + security findings to the team's channel: a
final `if: always()` step posting to a Slack/Discord/Teams webhook
(`SLACK_WEBHOOK_URL` secret), or GitHub notifications/summary only if no
channel is wanted. Notify on: production releases, failed deploys, rollbacks,
new HIGH/CRITICAL vulnerabilities.

## 8. Deliverables

```text
.github/workflows/{ci,release,deploy,rollback}.yml
deploy/cicd/
├── PIPELINE.md    # architecture: triggers, jobs, gates, versioning strategy, strategy choice
├── SECRETS.md     # every secret/variable: name, env, purpose, how to provision
└── RUNBOOK.md     # operate it: cut a release, approve a deploy, read a failure, roll back, rotate secrets
```

Success = every change validated automatically; deploys only from version
cuts; artifacts immutable and traceable (version + SHA); production behind
approvals; rollback quick, documented, and exercised; feedback fast (caching,
parallel jobs, fail-fast ordering).
