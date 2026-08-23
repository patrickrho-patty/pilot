# Pilot on EKS — ECR Build + EKS Deploy Pipeline

**Date:** 2026-08-23
**Status:** Approved design, ready for implementation
**Scope:** Custom fork deployment pipeline for the Patty-branded Pilot build (formerly `paperclip` fork at `patrickrho-patty/pilot`)

---

## 1. Goal

Give this custom build of Paperclip ("Pilot") its own deployment process, mirroring the established house pattern used by Buzz/Griddle:

1. **GitHub Actions** builds a Docker image and pushes it to **ECR**.
2. **GitHub Actions** deploys it to **EKS** (`rho-cluster`) via **Helm**, into a dedicated `pilot` namespace.

No product-core code changes are required. This is CI + deploy scaffolding only.

## 2. Context: Existing Infrastructure (surveyed 2026-08-23)

| Component | State |
|---|---|
| AWS account | `361645878435`, region `ap-northeast-2` |
| ECR | Live; existing repos follow `griddle`, `rho/api` naming. **New repo needed:** `pilot` |
| EKS | `rho-cluster` v1.35 ACTIVE, 4× amd64 nodes, public+private API endpoint |
| Namespaces | `production`, `staging`, `forge`, `nexus`, `search`, `griddle` — we add `pilot` |
| Storage | `gp2` StorageClass is cluster default; PVCs bind without extra config |
| Ingress | `aws-load-balancer-controller` + `external-dns` installed; shared ALB group `rho-alb-group`; ACM cert `arn:aws:acm:ap-northeast-2:361645878435:certificate/5cca1da8-9d23-468c-b623-c4aa774d9789` covers patty.io hosts |
| Precedent | Buzz/griddle: manual-dispatch GH workflow builds amd64 image → ECR; human runs `helm upgrade --install griddle deploy/charts/buzz -n griddle -f deploy/griddle-eks.yaml` from workstation |

**Decision (user-approved):** mirror the buzz/griddle pattern but with **deploy also automated from GitHub Actions** (helm upgrade in CI), not left as a local-only step.

## 3. Design

### 3.1 Pipeline Overview

```text
workflow_dispatch (tag input, e.g. v0.1.0-pilot)
        │
        ▼
┌──────────────────────────────┐     ┌─────────────────────────────────┐
│ Job 1: build-and-push        │     │ Job 2: deploy                   │
│                              │     │   needs: build-and-push         │
│ • checkout (full history)    │ ──▶ │ • configure AWS credentials     │
│ • login to ECR               │     │ • login to ECR                  │
│ • buildx linux/amd64         │     │ • aws eks update-kubeconfig     │
│   target: production         │     │   --name rho-cluster            │
│   tags: <input-tag>,         │     │ • helm upgrade --install        │
│           sha-<short>        │     │   pilot deploy/charts/pilot \   │
│   cache: type=gha            │     │   -n pilot -f deploy/rho-eks.yaml│
│ • push                       │     │   --set image.tag=<input-tag>   │
└──────────────────────────────┘     │ --atomic                        │
                                     │ • kubectl rollout status        │
                                     └─────────────────────────────────┘
```

### 3.2 Workflow file

New: `.github/workflows/ecr-build-deploy.yml`

Key properties (mirroring buzz's `ecr-build.yml`):

- **Trigger:** `workflow_dispatch` with input:
  - `tag` — image tag, e.g. `v0.1.0-pilot`
  - `deploy_enabled` — boolean, default `true`; allows build-only runs
- **Auth:** static AWS keys from repo secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (same secrets already proven in the buzz repo). No OIDC provider work.
- **Build:** `docker/build-push-action` with:
  - `context: .`, `target: production` (the Dockerfile has a later `cloud` stage; explicit target required)
  - `platforms: linux/amd64` only — matches rho-cluster nodes
  - `build-args:` `PAPERCLIP_BUILD_VERSION=${{ inputs.tag }}`, `PAPERCLIP_BUILD_COMMIT=${{ github.sha }}`, `CLI_TOOLS_CACHE_EPOCH=$(date -u +%G-W%V)` (ISO week so the CLI-tools layer refreshes weekly)
  - tags: `${{ inputs.tag }}` and `sha-${{ github.sha }}`
  - `cache-from/cache-to: type=gha,mode=max`
- **Lockfile refresh step** before build (copy from upstream docker.yml): `pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile` — keeps the Docker build context consistent.
- **Deploy job:**
  - `aws-actions/configure-aws-credentials` + `aws-actions/amazon-ecr-login`
  - `aws eks update-kubeconfig --name rho-cluster --region ap-northeast-2`
  - `helm upgrade --install pilot deploy/charts/pilot -n pilot --create-namespace -f deploy/rho-eks.yaml --set image.tag=${{ inputs.tag }} --atomic --wait`
  - Post-step verification: `kubectl rollout status deployment/pilot -n pilot`
- **Concurrency:** group `ecr-build-deploy-${{ github.ref }}`, `cancel-in-progress: false` (never kill an in-flight deploy).

### 3.3 IAM prerequisite

The deploy job needs, beyond ECR pull/push:

- `eks:DescribeCluster` on `rho-cluster` (for `update-kubeconfig`)
- Kubernetes RBAC permission to manage the `pilot` namespace

Cluster auth mode is `API` with the owner's IAM user mapped as an admin access entry, and CI uses that same identity's keys — so **no additional access entry is needed** unless dedicated scoped keys are introduced later.

> Hardening note (out of scope for V1): move CI to OIDC role assumption instead of static keys, mirroring what upstream would recommend. Tracked as future work.

### 3.4 Helm chart

New directory: `deploy/charts/pilot/`

```text
deploy/
├── charts/
│   └── pilot/
│       ├── Chart.yaml          # name: pilot, version 0.1.0, appVersion placeholder
│       ├── values.yaml
│       └── templates/
│           ├── _helpers.tpl
│           ├── serviceaccount.yaml
│           ├── secret.yaml             # optional create=false; see §3.6
│           ├── configmap.yaml          # non-secret env
│           ├── persistentvolumeclaim.yaml
│           ├── deployment.yaml
│           ├── service.yaml
│           └── ingress.yaml
└── rho-eks.yaml                # environment values for rho-cluster
```

#### values.yaml essentials

```yaml
image:
  repository: 361645878435.dkr.ecr.ap-northeast-2.amazonaws.com/pilot
  tag: latest            # always overridden by CI --set
  pullPolicy: IfNotPresent

replicaCount: 1          # single replica: embedded PG data dir is RWO

service:
  type: ClusterIP
  port: 3100

persistence:
  enabled: true
  size: 20Gi
  storageClass: ""       # gp2 default

ingress:
  enabled: true
  className: alb
  host: pilot.patty.io   # TBD: confirm hostname
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:ap-northeast-2:361645878435:certificate/5cca1da8-9d23-468c-b623-c4aa774d9789
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/group.name: rho-alb-group
    alb.ingress.kubernetes.io/healthcheck-path: /api/health
    alb.ingress.kubernetes.io/success-codes: "200"

resources:
  requests:
    cpu: "1"
    memory: 2Gi
  limits:
    memory: 4Gi
```

#### Deployment specifics

- **Image:** single container running the production stage CMD
  (`node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js`) via the image's own entrypoint — no override needed.
- **Security context:** `runAsNonRoot: true`, `runAsUser: 1000`, `runAsGroup: 1000`. The entrypoint detects non-root and execs directly (verified path in `scripts/docker-entrypoint.sh`); no UID remap needed since PVC will be chowned by kubelet-provisioned EBS as root — handled by the entrypoint's ownership probe only when running as root, so **first boot with a fresh volume must run once with default settings** if permissions issues appear; fallback documented below.

  > Fallback if fresh-PVC permission issues occur: drop `runAsNonRoot` for the first boot or add an initContainer `chown`-style fix using a tiny busybox image. Decide during implementation smoke test; prefer non-root.
- **Env (non-secret):**
  - `HOST=0.0.0.0`, `PORT=3100`, `SERVE_UI=true`
  - `NODE_ENV=production`
  - `PAPERCLIP_HOME=/paperclip`
  - `PAPERCLIP_PUBLIC_URL=https://<ingress-host>` (auth flows depend on this)
  - `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
- **Probes:**
  - liveness/readiness: HTTP GET `/api/health` on port 3100 (endpoint exists per AGENTS.md quick checks)
  - startup probe allowed generous window (server + embedded PG cold start)
- **Volume:** one RWO EBS PVC mounted at `/paperclip` holding embedded PostgreSQL data, uploaded assets, local secrets key, agent workspace state (per doc/DOCKER.md persistence contract).
- **Strategy:** `Recreate` (not RollingUpdate) — RWO volume can't attach to two pods; Recreate avoids multi-attach errors during redeploys.

### 3.5 Environment values — `deploy/rho-eks.yaml`

Mirrors `buzz/deploy/griddle-eks.yaml` style with a header comment documenting profile decisions:

```yaml
# Pilot on rho-cluster (EKS ap-northeast-2).
#
# Profile: embedded PostgreSQL persisted on an EBS gp2 PVC under /paperclip,
# matching the Docker quickstart contract (doc/DOCKER.md). Migrating to RDS
# later is a values-only change: set DATABASE_URL in the secret and disable
# persistence-managed embedded mode if desired.
```

Contains: final image repo/tag defaults, ingress host, resource sizing, and any rho-specific env overrides. Secrets stay out of git entirely.

### 3.6 Secrets

Required runtime secrets (created out-of-band, not committed):

```text
BETTER_AUTH_SECRET                    # openssl rand -hex 32
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET  # openssl rand -hex 32
# DATABASE_URL — unset initially (embedded PG); set when migrating to RDS
```

Chart approach: template references `existingSecret: pilot-secrets` (Opaque) created once via `kubectl create secret generic pilot-secrets -n pilot --from-literal=...`. Chart never renders secret values; CI therefore never needs them.

Rotation runbook note goes in chart README section.

### 3.7 Namespace & bootstrap

One-time bootstrap (documented in plan, executed manually):

```sh
kubectl create namespace pilot
kubectl create secret generic pilot-secrets -n pilot \
  --from-literal=BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  --from-literal=PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=$(openssl rand -hex 32)
aws ecr create-repository --repository-name pilot \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability MUTABLE
```

Then the first CI dispatch builds and deploys end-to-end.

## 4. Verification Plan

1. `helm lint deploy/charts/pilot && helm template pilot deploy/charts/pilot -f deploy/rho-eks.yaml` renders cleanly.
2. Dispatch workflow with tag `v0.0.1-smoke`: image appears in ECR with both tags.
3. Deploy job completes; `kubectl get pods -n pilot` shows Running with healthy probes.
4. `curl https://<host>/api/health` returns healthy through the ALB.
5. Redeploy with a second tag → rollout replaces pod (Recreate), health passes, no duplicate pods.
6. Rollback check: `helm rollback pilot -n pilot` restores previous revision.

## 5. Out of Scope (future work)

- Rebranding internals (`@paperclipai/*` packages, UI strings, docs) — separate effort, contract-touching across db/shared/server/ui.
- Integration Gateway implementation (per doc/BUZZ_INTEGRATION.md).
- OIDC-based CI auth replacing static keys.
- RDS/ElastiCache migration off embedded PostgreSQL.
- Multi-environment namespaces (staging/prod split) — single `pilot` namespace for now by decision.
- HPA/autoscaling (single replica due to embedded PG; revisit with RDS).

## 6. Open Items

| Item | Owner | Notes |
|---|---|---|
| Confirm ingress hostname (`pilot.patty.io`?) | Patrick | DNS record via external-dns or Route53 |
| First-boot permission smoke (non-root vs initContainer chown) | Implementer | See §3.4 security context |
| GitHub secrets present in `patrickrho-patty/pilot` repo | Patrick | Copy same key pair used by buzz repo |
