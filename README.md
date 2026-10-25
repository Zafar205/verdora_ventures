# Sustain Agro — Control Dashboard

Next.js dashboard for the two water-only sheds (aeroponic `AER-01`, hydroponic `HYD-01`), each with
three rows. Every shed has three sensor stations (front end, middle, back end), and each station has:

- environment sensors: temperature, humidity, light
- root-zone sensors: moisture and NPK

The headline value per shed is the average of the valid stations; an alert fires if the stations
disagree by more than a per-metric limit (likely a bad sensor). Actuators per shed: three row water
pumps (misting in aeroponic, circulation in hydroponic), a fan and a grow light. The dashboard also has
alerts, crop-profile limits, command history and an audit log.

```bash
npm run dev   # http://localhost:3000
```

## Current state: simulated gateway

There is no hardware or AWS link yet, so `lib/gateway.ts` simulates GW-01 (dummy telemetry every 5 s,
shed physics, local rules such as water the rows below the average-moisture minimum, fan above the temperature limit, switching protection,
manual override that beats rules). The UI only talks to the `/api/*` routes.

| Route | Purpose |
| --- | --- |
| `GET /api/state` | Full snapshot (readings, actuators, alerts, audit, permissions) |
| `GET /api/history?node=AER-01&metric=temp` | Last 30 min for the 3 stations |
| `POST /api/commands` | `{actuator, action: "on" \| "off" \| "auto"}` |
| `POST /api/mode` | `{mode: "manual" \| "rule"}` (admin only; ML is advisory and disabled) |
| `POST /api/profile` | `{shed, metric, min, max}` crop-profile limits |
| `POST /api/alerts` | `{id}` acknowledge |

Role permissions (`lib/rbac.ts`) mirror the report's access matrix and are enforced in the API, not
just by hiding buttons. The role is currently taken from an `x-role` header chosen in the UI —
**demo auth only**; replace with a verified session/JWT (e.g. Cognito) in `lib/http.ts`.

## Going live

Re-implement the exported functions of `lib/gateway.ts` against real infrastructure; routes and UI stay as is:

- `snapshot` / `history`: read latest + history from PostgreSQL (fed by AWS IoT Core rule → ingestion service).
- `sendCommand`: publish to a command topic (e.g. `site/zone/node/cmd`), mark the command `acked` when
  the gateway's acknowledgement arrives (the simulator fakes this after ~0.9 s).
- Persist the audit log and profiles in PostgreSQL; the in-memory store here resets on restart.
- Replace polling with a WebSocket/SSE push if update latency matters.
- Sensor positions, metrics, actuators and default limits live in `lib/model.ts`; adjust once exact sensor
  models and actuator wiring are confirmed.

## Surveillance (`/surveillance`)

Four cameras (entrance + interior per shed), an anomaly list and a detection log. Anomalies:

- **Door left open**: warning after 60 s, critical after 5 min.
- **Round check missed**: no completed round in a shed within 60 min (constants in `lib/surveillance.ts`).

The demo starts with the hydroponic round overdue so the alert is visible. The nav badge counts unacknowledged alerts on every page.

**Camera feeds:** set any of `CAM_AER_DOOR_URL`, `CAM_AER_INT_URL`, `CAM_HYD_DOOR_URL`, `CAM_HYD_INT_URL`
in `.env.local` to an MJPEG/snapshot image URL or an `.mp4`/`.webm` URL. Without one, a simulated feed is shown.
RTSP/HLS must be converted first (e.g. MediaMTX or go2rtc to MJPEG/WebRTC). Don't put camera passwords in these
URLs, because the browser receives them; put a proxy in front.

**Connecting your computer-vision service:** have it POST detections as they happen:

```bash
curl -X POST http://localhost:3000/api/surveillance/events \
  -H "x-cv-token: $SURVEILLANCE_TOKEN" -H "content-type: application/json" \
  -d '{"type":"round_completed","shed":"aeroponic","camera":"CAM-AER-INT","confidence":0.92}'
```

`type` is one of `person_detected`, `round_completed`, `door_open`, `door_closed`. Set `SURVEILLANCE_TOKEN` in
`.env.local`. Your CV code decides what counts as a "round" (e.g. a person passing all three rows) and sends
`round_completed`; this app only tracks the timing. In development, operators can also simulate events from the
page; that path is disabled in production builds.
