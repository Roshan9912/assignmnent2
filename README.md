# Flock Energy — Urja Meter API

A small, read-only REST service that gives downstream clients structured access to meter data from the legacy Urja Meter Ops portal. The service owns the portal login/session and converts its internal JSON and server-rendered detail page into a stable, snake_case API. API callers never need the portal login.

## Structure

- `src/portal-client.js` handles portal sign-in, the session cookie, requests, and one bounded retry after session expiry.
- `src/normalize.js` translates portal responses and parses server-rendered meter details.
- `src/app.js` defines the REST routes and consistent error responses.
- `src/server.js` configures and starts the service.
- `test/` contains normalization and session lifecycle tests.
- [`PROTOCOL.md`](./PROTOCOL.md) documents verified portal behavior.
- [`openapi.json`](./openapi.json) is the OpenAPI 3.1 API contract.

## Requirements and local run

Requires Node.js 18 or newer and npm.

```powershell
npm install
Copy-Item .env.example .env
```

Set `PORTAL_EMAIL`, `PORTAL_PASSWORD`, and `API_KEY` in `.env`. Generate a strong API key with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Copy the generated key into `API_KEY` in `.env`, and set it in the current PowerShell session for the sample requests (for example, `$env:API_KEY = '<the-generated-key>'`). Keep `.env` private; it is excluded from Git. The defaults for portal URL, local port, and request timeout are in `.env.example`.

```powershell
npm start
```

The API listens at `http://localhost:3000`. A quick liveness check is:

```powershell
curl.exe http://localhost:3000/healthz
```

The first portal-backed request logs in lazily. Requests time out after 10 seconds by default; set `PORTAL_TIMEOUT_MS` to override.

## API

| Method and path | Description |
| --- | --- |
| `GET /healthz` | Public process liveness; does not call the portal. |
| `GET /api/v1/meters?q=J100000&page=1` | Search by meter ID or serial number, with the portal's 20-item pages. |
| `GET /api/v1/meters/{meterId}` | Nameplate, location, distribution transformer, and network hierarchy. |
| `GET /api/v1/meters/{meterId}/hierarchy` | Just the meter's network path. |
| `GET /api/v1/meters/{meterId}/consumption` | All consumption readings currently returned by the portal. |
| `GET /api/v1/transformers?page=1` | Distribution transformers, with the portal's 20-item pages. |

All `/api/v1` endpoints require `Authorization: Bearer <API_KEY>`. Only `/healthz` is public. This protects meter locations and consumption data from anonymous access. The complete schemas and response codes are in [`openapi.json`](./openapi.json). Errors use `{"error":{"code":"...","message":"..."}}`; portal failures are surfaced as 502 responses rather than successful empty data.

### Sample requests

```powershell
curl.exe -H "Authorization: Bearer $env:API_KEY" "http://localhost:3000/api/v1/meters?q=J100000"
curl.exe -H "Authorization: Bearer $env:API_KEY" "http://localhost:3000/api/v1/meters/J100000"
curl.exe -H "Authorization: Bearer $env:API_KEY" "http://localhost:3000/api/v1/meters/J100000/consumption"
curl.exe -H "Authorization: Bearer $env:API_KEY" "http://localhost:3000/api/v1/transformers?page=1"
```

An abbreviated detail response:

```json
{
  "meter_id": "J100000",
  "serial_number": "SE33962",
  "make": "HPL",
  "phase_type": "single",
  "installation_status": "Decommissioned",
  "installation_type": "Whole Current",
  "distribution_transformer_code": "DT-001",
  "network_hierarchy": [
    { "level": "zone", "name": "Jaipur Zone 1", "code": "Z-01" },
    { "level": "circle", "name": "Circle 1", "code": "C-01" }
  ],
  "location": { "latitude": 26.938961002479868, "longitude": 75.83095696146852 }
}
```

An abbreviated consumption response:

```json
{
  "meter_id": "J100000",
  "interval_minutes": 30,
  "count": 337,
  "readings": [
    {
      "timestamp": "23/06/2026 23:30",
      "kwh": 48438.74,
      "kvah": 52313.84,
      "voltage_r": 226
    }
  ]
}
```

## Public deployment on Render

The repository includes a Render Blueprint in [`render.yaml`](./render.yaml). To create the public service:

1. Push the repository to GitHub (already done for this submission) and sign in to [Render](https://dashboard.render.com).
2. Choose **New → Blueprint**, connect `Roshan9912/assignmnent2`, and select the `main` branch.
3. When prompted for Blueprint environment variables, enter the portal login in `PORTAL_EMAIL` and `PORTAL_PASSWORD`. Generate a separate `API_KEY` using the command above and save it somewhere private; Render stores these values as service secrets.
4. Choose **Deploy Blueprint**. When the deployment finishes, copy the service's actual `https://….onrender.com` URL from its Render dashboard page.
5. Verify public liveness with `https://<your-render-host>/healthz`; call data routes with `Authorization: Bearer <your API_KEY>`.

The Render dashboard is the final source of the assigned service URL; it does not exist until you connect your GitHub account, provide the secrets, and deploy. Never put either the portal credentials or `API_KEY` in GitHub. Share the API key with the evaluator through a separate private channel if they need to call protected routes. The service deliberately leaves only `/healthz` unauthenticated.

## Assumptions, decisions, and trade-offs

- The service runs as one local process with one shared portal session. This is appropriately small for the take-home; a multi-worker deployment would need a deliberate session-sharing or per-worker-login strategy.
- Portal credentials are supplied only through environment variables. No credentials, cookie values, or user-supplied portal passwords are exposed in the API.
- API routes require a separately configured bearer key; `/healthz` remains public for hosting-provider health checks. This avoids anonymously exposing meter locations and consumption through the public service URL.
- Search and transformer page sizes remain fixed at the portal's observed 20 rows. The API exposes its page number and total, rather than fetching all pages on every request.
- Meter details combine the authenticated HTML detail route with the geo JSON route. Parsing the stable semantic `<dl>` and breadcrumb elements avoids coupling to SvelteKit's internal wire serialization, while still meaning upstream markup changes can require an adapter update.
- Consumption values are converted to numbers, but portal timestamps stay strings because no timezone is published. The currently available full reading set is returned; range filtering, pagination, and caching are omitted rather than guessing portal semantics.
- On 401/403 or redirect to `/login`, the client clears the session, re-authenticates, and retries once. Other upstream failures are reported explicitly.
- Meter identifiers are restricted to URL-safe letters, digits, `_`, and `-`; there is no reason for portal IDs to contain path separators.

## Intentionally left out / next improvements

- No write endpoints, portal UI, bulk exporter, cache, persistent local index, or multi-tenant credential store. The interface is read-only and the take-home's core is programmatic access.
- A hosted deployment is configured but must still be created in Render by connecting the GitHub repository and entering secrets; the public URL is assigned by Render after deployment.
- The portal exposes a UI action labelled “Export all meters,” but I did not rely on an unverified bulk route.
- With more time: add configurable consumption date windows after confirming upstream filtering semantics; add contract tests from sanitized portal fixtures; assess freshness/staleness and provide an explicit upstream data timestamp; add graceful rate limiting/circuit breaking; support shared session state for multiple workers; and verify whether the portal offers a supported bulk feed.
- `npm test` runs deterministic local tests. Live integration smoke tests are intentionally opt-in because they require network access and operator credentials.

## Run checks

```powershell
npm test
npm run openapi:check
```

## Reflection

**What assumptions did you make?** I treated the portal as a read-only system and assumed the API should hide the portal's authentication and naming conventions. Because the portal supplies no timezone for its timestamps, the API returns the timestamp text unchanged.

**Which part was most difficult, and how did you get unstuck?** Finding the actual data flow was harder than writing the routes: the portal presents normal HTML pages, but the network inspection showed small authenticated JSON routes for search, coordinates, consumption, and transformers. I compared the rendered detail page with those responses and used the semantic HTML for nameplate and breadcrumbs.

**If you had another day, what would you improve?** I would verify a supported bulk extraction path and consumption filtering, then add bounded date filters, freshness metadata, rate limiting, and tests against sanitized live response fixtures.

**What mistake did you make while solving this?** At first I expected a conventional JSON API and treated the meter detail route as if it would return a JSON object. The page is server-rendered; only the geo and energy parts have clean portal JSON endpoints, so the adapter had to parse the detail markup.

**If you were reviewing your own submission, what would you criticise?** Detail parsing still depends on portal labels and breadcrumb order, and the implementation has a single process-local cookie jar. The test suite uses local fixtures rather than making live checks, so it cannot detect an unannounced portal contract change by itself.
