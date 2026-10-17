# PRIMESTACK POS — Kubernetes Deployment (AWS EKS)

## Structure

```
k8s/
├── base/                          # Shared across all environments
│   ├── namespace.yaml             # primestack namespace
│   ├── serviceaccount.yaml        # IRSA service account
│   ├── configmap.yaml             # Non-secret config
│   ├── secret.yaml                # Secret template (DO NOT COMMIT REAL VALUES)
│   ├── external-secret.yaml       # AWS Secrets Manager → K8s Secret
│   ├── pvc.yaml                   # EFS persistent volume claim
│   ├── deployment-api.yaml        # Main POS API (autoscaled)
│   ├── deployment-vault-bank.yaml # Vault Bank settlement server
│   ├── deployment-tron-listener.yaml # Tron chain listener (isolated)
│   ├── services.yaml              # ClusterIP services
│   ├── ingress.yaml               # AWS ALB ingress
│   ├── hpa.yaml                   # Horizontal Pod Autoscaler
│   ├── network-policy.yaml        # Network isolation rules
│   └── poddisruptionbudget.yaml   # High availability
├── overlays/
│   ├── production/                # Production overrides (3 replicas, higher limits)
│   └── staging/                   # Staging overrides (1 replica, lower limits)
└── README.md
```

---

## Prerequisites

### 1. EKS Cluster
```bash
eksctl create cluster \
  --name primestack-eks \
  --region us-east-1 \
  --nodegroup-name standard \
  --node-type t3.medium \
  --nodes 3 \
  --nodes-min 2 \
  --nodes-max 10 \
  --managed
```

### 2. Required Add-ons

```bash
# AWS Load Balancer Controller (ALB Ingress)
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=primestack-eks

# EFS CSI Driver (persistent storage)
kubectl apply -k "github.com/kubernetes-sigs/aws-efs-csi-driver/deploy/kubernetes/overlays/stable/?ref=release-1.x"

# External Secrets Operator (AWS Secrets Manager)
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets-operator --create-namespace
```

### 3. ECR Repositories
```bash
aws ecr create-repository --repository-name primestack-pos --region us-east-1
aws ecr create-repository --repository-name primestack-vault-bank --region us-east-1
```

### 4. EFS File System
```bash
# Create EFS
aws efs create-file-system --region us-east-1 --tags Key=Name,Value=primestack-data
# Note the FileSystemId and update k8s/base/pvc.yaml: fileSystemId
```

### 5. AWS Secrets Manager
```bash
# Create the secret with all values from .env
aws secretsmanager create-secret \
  --name primestack/production \
  --region us-east-1 \
  --secret-string '{
    "JWT_SECRET": "...",
    "TRON_PRIVATE_KEY": "...",
    "WISE_API_KEY": "...",
    ...
  }'
```

---

## Deploy

### Production
```bash
# Replace placeholders first
sed -i 's/ACCOUNT_ID/123456789012/g' k8s/base/*.yaml k8s/overlays/production/*.yaml

# Apply
kustomize build k8s/overlays/production | kubectl apply -f -

# Watch rollout
kubectl rollout status deployment/primestack-api -n primestack
```

### Staging
```bash
kustomize build k8s/overlays/staging | kubectl apply -f -
```

---

## Values to Replace

| Placeholder | Where | What to put |
|------------|-------|-------------|
| `ACCOUNT_ID` | All YAML files | Your 12-digit AWS account ID |
| `REPLACE_WITH_EFS_ID` | pvc.yaml | Your EFS File System ID |
| `CERT_ID` | ingress.yaml | Your ACM Certificate ID |
| `primestack/production` | external-secret.yaml | Your Secrets Manager secret name |

---

## Pods Summary

| Pod | Replicas | Purpose |
|-----|----------|---------|
| `primestack-api` | 2–10 (HPA) | Main POS API + frontend |
| `primestack-vault-bank` | 1 (fixed) | Vault Bank settlement |
| `primestack-tron-listener` | 1 (fixed) | Tron USDT deposit watcher |

---

## CI/CD

Push to `main` → auto builds + deploys to production (requires approval).
Push to `staging` → auto deploys to staging.

GitHub Secrets required:
- `AWS_ACCOUNT_ID`
- `AWS_ROLE_ARN`
- `AWS_REGION`
- `EKS_CLUSTER_NAME`
- `NPM_TOKEN`
