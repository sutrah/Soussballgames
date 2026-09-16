# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, no-build, no-account website of camera-controlled mini-games ("Soussballgames"). Every game runs entirely in the browser: pose/hand tracking via MediaPipe Tasks Vision (loaded from CDN at runtime), no backend, no login. Plain HTML/CSS/vanilla ES modules — no `package.json`, no bundler, no framework, no test runner.

## Commands

- **Run locally**: `python3 -m http.server 8080` from the repo root, then open `http://localhost:8080`. A `SessionStart` hook (`.claude/settings.json`) already does this automatically for interactive sessions — check `http://localhost:8080` before starting a second server.
- **Syntax-check a JS file**: `node --check path/to/file.js` (parses only, never executes — safe, and pre-approved in `.claude/settings.json`). A `PostToolUse` hook runs this automatically on every `.js` file Claude writes or edits and reports errors back inline.
- There is no linter, formatter, or automated test suite configured. CI (`.github/workflows/ci.yml`) only runs `node --check` over every `.js` file on push/PR.
- Pushing to `main` or `claude/sleepy-pascal-rxsu3g` auto-deploys the site to GitHub Pages (`.github/workflows/deploy-pages.yml`) — requires "Pages → Source: GitHub Actions" enabled once in repo settings.

### Testing a game without a real camera

Games require `getUserMedia` + MediaPipe pose detection, so they can't be smoke-tested by just loading the page. The working pattern used throughout this repo's history:

1. Serve the repo (see above).
2. Drive it with Playwright + a **fake camera**: launch Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (and `--ignore-certificate-errors`, since MediaPipe/PeerJS CDN assets go through this environment's TLS-intercepting proxy). The fake device is a synthetic pattern with no real body in it, so `PoseController` will report `null` landmarks — enough to test UI flow, camera activation, and "no input" states, but not gesture-driven scoring.
3. To verify actual gesture/physics logic (scoring, state machines, level progression) without a real body, temporarily add a `?debug=1`-gated `window.__debugXxx` hook at the bottom of the game's `.js` file that exposes internal state and lets a test script inject synthetic gesture values directly (bypass `PoseController` entirely). **Remove the hook before committing** — it's scaffolding, not a shipped feature.
4. **Known environment quirk, not a game bug**: in this sandbox, MediaPipe falls back to software WebGL (no real GPU), which can make `requestAnimationFrame` run far slower than wall-clock time. Game loops here clamp `dt` per frame (`Math.min(0.033, ...)`), so under this slowdown *simulated game-time* runs in slow motion relative to real seconds. Don't re-diagnose this as a physics bug — it doesn't happen for real users with real GPUs/cameras. When timing matters for a test, drive the game via the `?debug=1` hook (module-level `t`/state, not wall-clock waits) rather than trying to time real camera-frame cadence.
5. Backgrounding a long-lived process (e.g. a test HTTP server) via a Bash tool call only survives if started as `(cmd &)` at the top level of the command — piping it through a nested `bash -c` or `setsid`/`disown` gets reaped when the tool call returns, in this sandbox specifically.

## Architecture

### Shared modules (`assets/js/`)

- **`pose/PoseController.js`** — wraps `getUserMedia` + MediaPipe `PoseLandmarker` (loaded from `cdn.jsdelivr.net`, GPU delegate). Exposes `onFrame(lm, now)` with 33 landmarks, already mirrored (`x' = 1 - x`) so gestures map naturally to what the user sees of themselves. `LM` exports named landmark indices.
- **`pose/gestures.js`** — reusable signal-processing primitives built on raw landmarks: `EMA`/`Baseline` (smoothing/adaptive baseline), `EdgeTrigger` (hysteresis-based rising-edge detector used for step/jump/push detection), plus higher-level one-shot gestures (`handsRaised`, `armsSpread`, `lateralZone`, `shoulderTilt`, `kneeLift`). New games should extend this file rather than re-deriving detection math inline.
- **`pose/skeleton.js`** — draws the small calibration skeleton shown in every game's camera-preview thumbnail.
- **`render/perspective.js`** — shared pseudo-3D "road scrolling toward the camera" projection (`scaleAt`/`yAt`/`xAt` from a `z∈[0,1]` depth), used by both the runner and skate games so their ground/lane math stays consistent.
- **`net/PeerRoom.js`** — WebRTC P2P wrapper over PeerJS's public broker (signaling only; gameplay data flows peer-to-peer). No server to host, matches the "no account, no backend" constraint. **Caveat**: this sandbox's proxy blocks the WebSocket handshake to `0.peerjs.com` (likely datacenter-IP blocking on the free broker's side), so live two-peer connection can't be verified from inside this environment — only the post-connection game logic can be (see the room game's approach below).

### Per-game structure (`games/<name>/`)

Each game is `index.html` (UI shell: start overlay with instructions, game-over/summary overlay, small camera-preview thumbnail, HUD) + one `<name>.js` module. All follow the same loop shape:

1. `PoseController.onFrame(lm)` updates module-level gesture state (booleans/floats) from live landmarks — kept minimal and cheap since it fires every camera frame.
2. A single `requestAnimationFrame` loop calls `update(dt)` (physics/state advance, reading the gesture state above) then draws to a `<canvas>`.
3. A keyboard (or mouse, for `climb`) fallback path sets the same gesture state variables, so games are testable/playable without a working camera.

Notable per-game specifics:
- **`flappy`** — control is two floor "tiles" (left/right halves of the frame, detected via ankle position) alternately lit by a fixed-tempo metronome, *not* a knee-lift gesture. This mirrors the proven "Pas de Patineur" exercise in the sibling reference repo `sutrah/weballgames` (`squelette.html`), which uses exactly this zone+metronome approach — check that file first before changing this game's input model. Successfully stepping on the lit tile advances the metronome target (`advanceBeat()`); missing it also advances (never stalls). Has an intro countdown and pauses entirely while feet aren't detected, so the player is never punished before they're in frame.
- **`subway`** (runner) and **`skate`** both use `render/perspective.js` for their scrolling ground.
- **`rooms`** (2-player co-op) is **host-authoritative**: only the host runs the 5-level puzzle state machine; the guest just renders whatever state the host broadcasts, and both sides also broadcast their own local gesture state (`handsUp`/`crouch`/`spread`/`lane`) plus a reduced 11-point landmark set for rendering the other player's stick figure.
- **`climb`** — the gripped hand's *rendered* position is deliberately clamped to a realistic arm length from the shoulder (`clampToArm`), decoupled from the *real* wrist position used for the underlying grab/climb physics — this was a deliberate fix for the arm otherwise visually stretching to the true (far) wrist position. Don't collapse these back into one value.

### Styling

`assets/css/main.css` is the one stylesheet for the landing page and every game shell (dark glassmorphism theme: `--bg-*`, `--accent*` custom properties). Game-specific visuals are drawn on `<canvas>`, not in CSS.
