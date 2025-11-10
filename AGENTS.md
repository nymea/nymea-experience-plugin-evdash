# Agent Instructions

Welcome to the nymea EV-Dash experience plugin repository. This project ships a Qt-based experience plugin together with a small
HTML dashboard that visualises EV charger information exposed by nymea. The following notes summarise the most important pieces
you will touch while working on tasks in this repository.

## Purpose
- Deliver a secure, brandable dashboard that shows the status of configured EV chargers, their live data and actions.
- All browser interactions flow through a nymea web server resource that authenticates users and distributes data via WebSocket
  push events.

## Repository Structure
- `plugin/`
  - Contains the Qt/C++ implementation of the experience plugin.
  - `EvDashWebServerResource` is responsible for HTTP handling under `/evdash`, including REST endpoints such as the login flow and
    serving the compiled dashboard assets from `dashboard.qrc`.
  - `EvDashEngine` runs the WebSocket server, receives JSON requests with `{ requestId, action, payload }`, authenticates clients via
    session tokens and pushes live updates.
  - `EvDashJsonHandler` defines the JSON-RPC schema for nymea integration (keep new actions consistent with this handler).
- `dashboard/`
  - Browser-based UI written in HTML and vanilla JavaScript (`index.html`, `app.js`). The files are bundled into the plugin through
    `dashboard.qrc`.
  - Use CSS variables for branding (primary/secondary/accent colours, icons) so the dashboard can be themed easily.

## Implementation Guidelines
- Maintain the request/response contract documented in the repository README and API discussions:
  ```json
  { "requestId": "uuid", "action": "ActionName", "payload": { } }
  ```
  Every response must echo the `requestId`, set `success` and either contain `payload` or an `error` string.
- The WebSocket connection stays closed for unauthenticated clients. They must send an `authenticate` action with a valid login
  token obtained via `POST /evdash/api/login`. Reject subsequent requests until the token is validated.
- When adding UI behaviour, ensure the login overlay is shown before establishing a WebSocket connection and that connection status
  is clearly visible for operators.

## Coding Style
- C++/Qt: follow Qt conventions (camelCase, `m_` member prefixes, grouped/alphabetised includes, Qt containers, Qt logging macros).
- JavaScript: prefer small helper functions, avoid external dependencies, keep DOM selectors at the top of the file, and document
  any public methods intended for use from the developer console.

## Workflow & Testing
- Keep commits focused and group related changes across frontend/backend in the same patch where it improves traceability.
- Mention any manual or automated verification steps in commit messages and PR summaries. If tests are unavailable, explain why.

Thank you for contributing!
