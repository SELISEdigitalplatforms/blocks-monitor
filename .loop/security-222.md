# Security — #222

## Tools
- opengrep 1.30.0
- trivy 0.74.0

## OpenGrep
- Command: `opengrep scan --config auto --json -o .loop/results-222/opengrep-final.json .`
- Findings: **0** (was 65; fixed in this PR)

### Remediations
- Pin GitHub Actions `uses:` tags to commit SHAs (mutable-action-tag)
- Move `${{ }}` interpolations out of `run:` into step `env:` (run-shell-injection)
- Replace `secrets: inherit` with explicit secret maps
- progress-and-card test: `replace(/%/g, "")` (incomplete-sanitization)
- e2e orphan name matching without RegExp constructor; console.warn separate args
- `scripts/junit-to-sonar.py` → defusedxml.ElementTree

## Trivy
- Command: `trivy fs --scanners vuln,secret,misconfig --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --format json -o .loop/results-222/trivy-final.json .`
- Findings: **0** (was 4 Dockerfile misconfigs)

### Remediations
- Dockerfile: WORKDIR instead of `RUN cd`; HEALTHCHECK + wget
- Dockerfile.worker: HEALTHCHECK + procps

## Verdict
PASS — 0 OpenGrep, 0 Trivy (all severities).
