---
name: deploy-orchestrator
description: Executes build checks and staging deployments for the frontend and backend.
---
# Execution Flow
1. Run standard build commands (`cargo build --release` / `npm run build`).
2. Verify local compilation before pushing artifacts.
3. Monitor stdout/stderr for warnings.

## Guidelines
- Never execute a deployment if uncommitted git changes exist in the worktree.
- Halt execution and report immediately if strict type-checking fails.
