# Carmori

**Carmori remembers your car and helps you work on it.** It briefs you in the car and answers questions from your own records. Then it watches through a mounted phone camera while you refill washer fluid, moves to the next step without a tap, and saves what it actually saw.

**Brief → Ask → Inspect → Refill → Remember**

Built for the Meta Global AI Developer Hackathon 2026 with Muse Spark 1.3, Muse Voice Transcribe 1.0 and SAM 3.1. The demo car is a 2014 Hyundai Sonata.

---

## What it does

| Area | What the user gets |
| --- | --- |
| **Home** | A spoken briefing built from saved records, rain over the past 7 days and care rules. Each item shows why it matters and what is still unknown. |
| **Ask** | Answers from stored facts only. If the model cannot point to a fact, Carmori does not read the answer out. |
| **Washer refill** (Home or Guide) | A full-screen camera guide: find the inlet, lift the cap, show the bottle, pour, close. Cards and cues appear inside the camera view. |
| **Guide → Tire check** | An 8-shot visual check (sidewall and tread on each wheel). It rejects blurry, dark or wrong-angle shots. It does not measure tread depth or pressure. |
| **Status** | Mileage, care status per part and a 3D view of the car. |
| **Places** | Nearby washer-fluid shops and car washes, the parked-car spot and a Find my car compass view. |
| **History / Documents** | User-confirmed maintenance records with photos, plus vehicle documents. |
| **In the car** | In the iOS and Android shells, the briefing can start when CarPlay or Android Auto connects. |

### How the hands-free refill decides

The phone sits on a mount and keeps sending short two-frame windows. Muse Spark describes each window, and a server state machine, not the model, decides the step:

```
FIND_INLET → OPEN_CAP → CONFIRM_PRODUCT → POUR → FINISH → RECORDED
```

- A step advances only when **two separate observations agree**.
- **UNKNOWN means wait.** If the cap is blocked, the label can't be read or the pour is hidden, Carmori holds the step and says why.
- **Voice cannot approve** a product or an inlet that the camera has not confirmed.
- **A wrong product stops the flow:** "This isn't washer fluid. Don't pour it." (for example coolant or a coffee cup).
- **A late answer can't skip ahead.** Old answers are dropped by sequence number and state version.
- **Records say where they came from.** A refill seen on camera is saved as `observed_sequence`. If the pour was hidden, Carmori asks, and saves `user_voice_confirmed` only after you say yes.
- Carmori never estimates the fluid level or how much you poured.

---

## Demo (3 minutes)

### Before you start

- Engine off and cool, hood open, car parked.
- Phone on a fixed mount with both hands and the washer inlet in view, in good, even light.
- A real washer-fluid bottle with a readable label. If you show coolant or oil, only show the label. Never pour it into the washer tank.
- Backend running with `META_API_KEY`. The top bar shows **Demo Mode** when step checks are simulated. Don't present Demo Mode as real camera recognition.
- The car is registered as **2014 Hyundai Sonata**, so the Sonata guide is used.
- Camera, microphone and location are on in **Menu → Settings**.

### Run of show

| Time | Scene | What to show |
| --- | --- | --- |
| 0:00–0:25 | In the car, play the briefing on **Home** | A spoken summary from saved records, with captions. |
| 0:25–0:50 | Ask "Why should I check the washer fluid?" | The answer separates what is known from what isn't. |
| 0:50–1:20 | **Refill washer fluid, hands-free** on Home (or **Guide → Washer fluid**), then mount the phone | The inlet pin appears. Lift the cap, and the step moves on without a tap. |
| 1:20–1:55 | Hold up the bottle, then pour with both hands | The label match card, then the pour cue. Optional: show coolant first to get "This isn't washer fluid." |
| 1:55–2:25 | Stand the bottle up and close the cap | The record is saved from what the camera saw. |
| 2:25–3:00 | Back in the car, ask "What did I do today?" | The answer uses the new record. |

**If something goes wrong on stage:** cover the cap with your hand. Carmori waits and says the view is blocked, then resumes on the same step. Showing this on purpose is a good way to show the safety rules.

---

## Run it locally

Requires Python 3.10+, Node 22 and pnpm.

```bash
cp .env.example .env
```

Set `META_API_KEY` in `.env`.

**Backend** (port 8000)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn carmori.main:app --host 127.0.0.1 --port 8000 --env-file ../.env --reload
```

**Web** (port 5173). Vite forwards `/api` to the backend.

```bash
cd web
pnpm install
CARMORI_HTTP=1 pnpm dev
```

Open http://localhost:5173. Without `CARMORI_HTTP=1`, Vite serves HTTPS with a self-signed certificate.

### On a phone

Camera and microphone need HTTPS that the phone trusts. Put the phone and the Mac on the same network (a phone hotspot works), then create a certificate for the Mac's IP address:

```bash
cd web
./scripts/create-local-https-cert.sh <Mac IP>
```

Install `web/.local-https/ca.crt` on the phone and fully trust it (iOS: Settings → General → About → Certificate Trust Settings). Then start Vite with the command the script prints:

```bash
CARMORI_HTTPS_CERT=.local-https/server.crt CARMORI_HTTPS_KEY=.local-https/server.key pnpm dev -- --port 5174
```

Open `https://<Mac IP>:5174` in Safari. Keep `ca.key` and `server.key` private.

### Optional

- **Live speech-to-text:** [voice-service/README.md](voice-service/README.md) runs a Pipecat service on port 7860. Without it, the browser's voice detection and batch transcription are used.
- **Native shells:** `web/ios` and `web/android` are Capacitor 8 projects with a small CarConnection plugin for CarPlay/Android Auto detection and native speech. Point them at the dev server with `CAP_SERVER_URL=http://localhost:5173 pnpm cap sync ios` (see `web/capacitor.config.ts`).

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `META_API_KEY` | none | Meta API key. Server-side only, never sent to the browser. |
| `META_API_BASE_URL` | `https://api.meta.ai/v1` | Meta API endpoint. |
| `CARMORI_SPARK` | `meta` with a key, otherwise `fake` | `fake` simulates step checks and shows Demo Mode. |
| `SPARK_VISION_MODEL` | `muse-spark-1.3` | Vision model for scenes and photo checks. |
| `SPARK_REASONING_EFFORT` | `minimal` in `.env.example` | Effort for live step checks. Photo checks use the model default. |
| `SPARK_TIMEOUT_S` | `20` | Model request timeout in seconds. |
| `CARMORI_DB_PATH` | `backend/data/carmori.sqlite` | SQLite file. |
| `CARMORI_MANUAL_AUTO_FETCH` | `true` | Download verified owner's manuals after a car is added. |
| `CARMORI_CORS_ORIGINS` | localhost | Allowed web origins. |
| `CARMORI_HTTP`, `CARMORI_HTTPS_CERT`, `CARMORI_HTTPS_KEY` | none | Vite: plain HTTP, or a trusted certificate for the phone. |

---

## Supported car and data sources

The guided refill is tuned for the **2014 Hyundai Sonata (YF, GLS 2.4 GDI)**. Register year 2014, make Hyundai and model Sonata, and the server attaches the `hyundai_sonata_2014` guide. Other cars, including the Sonata Hybrid, get a general guide and show maker-specific items as unavailable.

- **Owner's manual** (2014 Sonata, US edition): washer inlet at the front passenger side of the engine bay, next to the coolant reservoir (pp. 4-82, 7-2); check washer fluid at each fill-up (p. 7-5); never add coolant to the washer tank (p. 7-27); warning lights (p. 4-74); tire pressure 34 psi for P205/65R16 and P215/55R17 (p. 8-3). The manual gives no washer tank capacity, so Carmori never states one.
- **Demo car check (2026-10-29):** the inlet is at the front passenger-side corner, with the translucent coolant reservoir right behind it. Cap color is not used for detection.
- **Weather:** Open-Meteo rain over the past 7 days. A failed lookup shows as unavailable, never as a made-up value.
- **Vehicle data:** NHTSA vPIC for VIN decoding and the make/model list. Nearby places come from OpenStreetMap (Overpass).
- **Car photo:** a 2013 Sonata GLS photo under CC BY-SA 4.0 ([credits](web/public/CREDITS.md)).

---

## Tests

```bash
cd backend
.venv/bin/pytest -q
.venv/bin/carmori-replay ../fixtures/clips
```

`carmori-replay` runs the state machine over 16 scripted clips: a normal refill, flicker, a blocked view, a wrong bottle, a bottle swap, an empty-bottle pour, late and out-of-order answers, and voice trying to approve a product. It fails on any wrong record. CI runs both, plus `pnpm build`.

**Real-clip test set:** [docs/REAL_CLIP_TEST_SET.md](docs/REAL_CLIP_TEST_SET.md) lists 12 cases (14 clips) to film on the real car, with the expected result for each. `python -m carmori.annotate --case <id>` asks the model once per frame window and saves the answers. `carmori-replay --report` then writes a results table, and rule changes can be re-checked with no API cost.

---

## API

| Route | Purpose |
| --- | --- |
| `POST /vehicles`, `GET/PATCH /vehicles/{id}` | Add, read and edit a car |
| `POST /vehicles/recognize`, `POST /vehicles/recognize-document` | Read a VIN plate, car photo or document |
| `GET /vehicles/{id}/care-recommendations` | Care priorities with reasons and weather status |
| `GET /vehicles/{id}/maintenance-records`, `POST /maintenance-records` | User-confirmed records and photos |
| `POST /vehicles/{id}/inspections/analyze` | Washer inlet, product label and tire photo checks |
| `POST /sessions`, `POST /sessions/{id}/observations`, `POST /sessions/{id}/voice` | Hands-free refill state machine |
| `POST /sessions/{id}/tracks?target=cap\|bottle\|inlet` | SAM 3.1 masks for a short MP4 (6 MB max). Never completes a step on its own. |
| `POST /briefings`, `POST /assistant/ask`, `POST /voice/transcribe` | Briefing, grounded questions, transcription |
| `GET /places/nearby` | Nearby shops and car washes |

## Project layout

```
backend/carmori/   FastAPI app, state machine, prompts, photo checks, replay and annotate tools
backend/tests/     pytest suite
fixtures/clips/    scripted replay clips
web/src/screens/   Home, Setup, Work (refill guide), TireVisualGuide, Places, …
web/ios, android/  Capacitor shells with the CarConnection plugin
voice-service/     optional Pipecat speech-to-text
docs/              design notes and the real-clip test set
```

---

## Limits

- **Real-world accuracy is not proven yet.** The replay clips are scripted. Step accuracy, delay and mount position still need the real-clip test set and full runs on the car.
- Photo checks (inlet, label, tire) take several seconds each. Live step checks depend on network and model speed.
- Carmori does not measure fluid level, amount poured, tread depth or tire pressure. It shows what is visible and saves gauge readings you enter.
- The inlet cue is a 2D marker at a fixed spot on screen, not tracked 3D AR. It relies on the phone staying on the mount.
- SAM 3.1 track IDs last only for one clip request, and the refill screen doesn't show them yet.
- Without a working Meta key (billing or model access), photo checks, automatic steps and transcription are unavailable. The app says so and never records a step it didn't see. Manual records still work.
- This is a local prototype with no accounts. The browser remembers the car ID in `localStorage`. Add sign-in and ownership checks before any public deployment.
