# Binding and Official Bot API

This document covers controlled binding and official bot query endpoints.

These endpoints are not third-party `public.read` APIs. They are split by credential type:

- Site user endpoints prefer the same-origin HttpOnly site Session; documented Bearer input remains a transition path.
- Official bot query endpoints use an `official_bot` API key with `bot.self.read`.
- Binding verification uses a provider-specific verifier secret, not the read-only bot key.

During the authentication hardening transition, clients should send exactly one site-user credential. If Cookie and Bearer are both present, the local Phase B candidate requires the same user ID and rejects mismatches; the candidate is not yet merged or deployed. This platform-binding API is separate from GitHub / LinuxDo / QQ login identities. See `AUTH_SECURITY_HARDENING.md`.

## Site User Binding Endpoints

### `GET /api/integrations/bindings/me`

Authentication:

```http
Authorization: Bearer <site user access token>
```

Returns the current user's binding status for `discord`, `telegram`, and `qq`.

Pending challenges include `challenge_code`; verified bindings do not expose `platform_user_id`.

### `POST /api/integrations/bindings/challenge`

Authentication:

```http
Authorization: Bearer <site user access token>
```

Body:

```json
{
  "provider": "telegram"
}
```

Creates or refreshes a short-lived binding challenge.

### `POST /api/integrations/bindings/revoke`

Authentication:

```http
Authorization: Bearer <site user access token>
```

Body:

```json
{
  "provider": "telegram"
}
```

Revokes the current user's active binding for that provider.

## Bot Binding Verification Endpoint

### `POST /api/integrations/bindings/verify`

Authentication:

```http
X-API-Key: <provider verifier secret>
```

Body:

```json
{
  "provider": "telegram",
  "challengeCode": "ABCD2345",
  "platformUserId": "123456789",
  "displayHandle": "@example"
}
```

This endpoint only consumes a binding challenge and marks the binding verified. It cannot read user analytics.

## Official Bot Query Endpoints

Authentication:

```http
X-API-Key: <official bot read-only key>
```

Required scope:

```text
bot.self.read
```

All endpoints require:

- `provider`
- `platformUserId`

The provider must match the official bot client provider. For example, a Telegram bot key cannot query a Discord binding.

### `GET /api/dev/v1/bot/dashboard`

Returns bound-user dashboard summary.

### `GET /api/dev/v1/bot/self-summary`

Legacy-compatible bound-user summary endpoint.

### `GET /api/dev/v1/bot/pools`

Returns bound-user pool index grouped by game account display name.

### `GET /api/dev/v1/bot/recent-pulls`

Query:

- `limit`: default `10`, max controlled by server

Returns recent high-rarity pull summaries.

### `GET /api/dev/v1/bot/pool-detail`

Query:

- `poolId`
- `gameUid` optional internal selector

Returns one bound user's pool detail, timeline sections, and share payload.

### `GET /api/dev/v1/bot/analysis`

Returns the API-first analysis workspace for a bound user. This endpoint is the preferred data source for official BOT clients and future integrations.

Query:

- `accountRef` optional opaque account selector returned by this endpoint
- `poolRef` optional opaque pool selector returned by this endpoint
- `gameUid` / `poolId` legacy internal selectors, kept for backward compatibility

Response highlights:

- `navigation.accounts[]`: game account display names and switchable pool entries
- `selected.account`: currently selected game account
- `selected.pool`: currently selected pool summary
- `selected.detail`: pool analysis detail, timeline sections, and the same share payload used by the website share card

User-facing clients should prefer `ref` fields for callbacks and menus. Do not show `gameUid` or `poolId` in visible text.

### `GET /api/dev/v1/bot/share-card`

Generates a PNG share card for the selected bound-user pool.

Query:

- `poolRef` preferred
- `accountRef` optional
- `poolId` / `gameUid` legacy fallback
- `theme`: `dark` or `light`, default `dark`

Returns:

```json
{
  "image": {
    "file_name": "...png",
    "mime_type": "image/png",
    "encoding": "base64",
    "content_base64": "..."
  }
}
```

The renderer uses the website dashboard share card component and the same `share_payload` / `timeline_sections` produced for the analysis page. If Playwright is unavailable, the endpoint returns a normal API error instead of a fake summary card.

### `GET /api/dev/v1/bot/pool-log`

Exports the selected pool's detailed log file for a bound user.

Query:

- `poolRef` preferred
- `accountRef` optional
- `poolId` / `gameUid` legacy fallback
- `format`: `csv` default, or `json`, `txt`

Returns a base64 file payload:

```json
{
  "file": {
    "file_name": "...csv",
    "mime_type": "text/csv; charset=utf-8",
    "encoding": "base64",
    "content_base64": "..."
  }
}
```

The exported file intentionally omits raw history record IDs, `user_id`, `platform_user_id`, raw `gameUid`, and raw `poolId`. It is still private bound-user data and must only be sent back to the bound platform account.

## Privacy Boundary

User-visible and third-party outputs must not include:

- Email
- `platform_user_id`
- `user_id`
- Raw history record IDs
- Raw history dumps

Official bot callbacks may carry internal routing refs such as `gameUid` and `poolId`, but public text should display pool names and game nicknames instead.

## Runtime Data Source

Official bot runtime code should obtain display data through the HTTP API layer:

- Bound-user data: `/api/dev/v1/bot/*`
- Public site/catalog data: `/api/dev/v1/site/overview` and public catalog/stat endpoints
- Binding verification: `/api/integrations/bindings/verify`

Bot adapters and notification senders should not call dashboard/catalog builder functions directly. If an API route needs to aggregate database data, that aggregation should remain inside the API handler layer.
