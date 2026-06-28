# Debug Session: `project-api-timeout`

Status: [OPEN]

## Symptom

- Vite proxy times out for `/api/Project/Get?projectId=...`
- Frontend runs on `https://dev-monitor.blocksdevelopers.com:4001/`
- Backend is reported as running on `https://0.0.0.0:5001`

## Initial Hypotheses

1. Vite proxies `/api/*` to `https://dev-monitor.blocksdevelopers.com:5001`, but the backend is only bound/reachable through `0.0.0.0` or `localhost`, not that hostname.
2. The hosts-file / mkcert setup is incomplete, so `dev-monitor.blocksdevelopers.com:5001` does not resolve back to the local backend on this machine.
3. The backend is reachable, but the specific `/api/Project/Get` route hangs because of downstream dependency issues, auth middleware, or DB access.
4. The frontend request is hitting the wrong service base URL or wrong proxy branch, so `/api/Project/Get` is being sent to a target that is up but not serving this route correctly.
5. TLS mismatch exists between the Vite proxy and backend listener, such as HTTPS configured in frontend but backend actually serving plain HTTP on port `5001`.

## Evidence To Collect

- Effective Vite proxy target values at runtime
- DNS / hosts resolution for `dev-monitor.blocksdevelopers.com`
- Direct reachability of backend by hostname and by localhost
- Direct response behavior of `/api/Project/Get`
- Whether timeout is network-level or application-level

## Notes

- No business-logic changes made yet.
- First code change must be instrumentation only, if instrumentation is needed.

## Evidence Collected

- `client/.env` sets `BLOCKS_MONITOR_BASE_URL=https://dev-monitor.blocksdevelopers.com:5001`
- Direct request to `https://localhost:5001/api/Project/Get?...` succeeds at the transport level and returns:
  - `400 {"Errors":{"Message":"BadRequest: Missing_Tenant_Key_Or_Id"},"IsSuccess":false}`
- Direct request to `https://dev-monitor.blocksdevelopers.com:5001/api/Project/Get?...` times out
- Host lookup during debugging resolved `dev-monitor.blocksdevelopers.com` to public IPs instead of the expected local loopback target

## Hypothesis Status

1. Vite proxies to the wrong host for local backend: CONFIRMED
2. Hosts-file / local resolution is not being applied effectively for the backend domain: SUPPORTED
3. Specific endpoint logic hangs after connection: REJECTED for this symptom, because localhost responds immediately
4. Wrong service base URL / wrong proxy branch: CONFIRMED for monitor API target selection
5. TLS mismatch on port `5001`: NOT PRIMARY; HTTPS on localhost works
