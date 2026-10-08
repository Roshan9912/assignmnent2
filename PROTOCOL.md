# Urja Meter Ops protocol notes

These notes record behavior observed against the supplied, read-only operator account on 8 October 2026. The portal is a server-rendered SvelteKit application; its screen routes are not themselves the clean data API.

## Authentication

- The browser begins at `/login`. The form submits `application/x-www-form-urlencoded` fields named `email` and `password` to `POST /login`.
- A same-origin `Origin` and `Referer` are required; a direct cross-site form submission is rejected.
- On success the action returns a JSON redirect instruction to `/meters` and sets an HTTP-only cookie named `__Secure-better-auth.session_token`. The adapter first GETs `/login`, posts the form, retains response cookies, and sends the cookie on subsequent requests.
- No bearer token or CSRF form field was observed. The HTTP-only session token must be treated as a secret and is never returned from this service.
- The session should be renewed after an upstream 401/403 or redirect to `/login`. The adapter retries an authenticated request at most once after logging in again.

## Data routes observed

| Portal route | Method | Observed response / purpose |
| --- | --- | --- |
| `/portal/meters/search?q=&page=1` | GET | JSON `{data,total,page,pageSize}`; 20 meters per page. `q` searches meter number or serial. |
| `/meters/{meterId}` | GET | Server-rendered HTML with nameplate fields, network breadcrumbs, and location. The detail content is not exposed as a dedicated clean JSON detail route. |
| `/portal/meters/{meterId}/geo` | GET | JSON coordinates; latitude and longitude arrive as strings. |
| `/portal/meters/{meterId}/energy` | GET | JSON `data` array containing timestamp, kWh, kVAh, and R-phase voltage. |
| `/portal/dts?page=1` | GET | JSON `{data,total,page,pageSize}` for distribution transformers. |

The observed meter search reported 403 meters. Transformer listing reported 40 transformers over two pages. One meter's energy response contained 337 readings at 30-minute intervals (23 June through 30 June 2026 inclusive). The exact available window is data-dependent and should not be hard-coded.

## Shape and quirks

- Search summaries use camelCase fields (`meterId`, `serialNo`, `phaseType`, `installStatus`, `dtCode`); the API maps them to snake_case.
- Nameplate labels in the detail HTML are `Meter ID`, `Serial No`, `Make`, `Phase Type`, `Installation Status`, and `Installation Type`. The adapter parses the server-rendered `<dl>` rather than depending on the framework's internal serialized page-data format.
- Hierarchy breadcrumbs are ordered Zone → Circle → Division → Subdivision → Substation → Feeder → Distribution Transformer; each visible label includes a name and a code in parentheses.
- Consumption numeric values arrive as strings and are converted to JSON numbers. Timestamps use `DD/MM/YYYY HH:mm`; no timezone is stated, so the API preserves the original string rather than inventing UTC.
- The portal serves readings at 30-minute cadence in the observed record. R-phase voltage is named `voltR` upstream and exposed as `voltage_r`.
- The portal contains a UI button labelled “Export all meters,” but a bulk export endpoint was not established as part of this implementation.
- Before fetching detail, hierarchy, or consumption, the adapter uses the search endpoint to confirm that the exact meter ID exists. This avoids reporting a portal's missing-page HTML as valid detail.

## Operational boundary

All access performed was via ordinary authenticated GETs and the provided sign-in. The API is read-only and does not expose sign-out or any portal mutation. The portal can change its routes or HTML without notice; integration tests against fixtures cover normalization and session behavior, but do not eliminate that upstream contract risk.
