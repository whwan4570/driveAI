# Carmori

**A hands-free car-care guide that sees the task, helps you finish it, and remembers what happened.**

<p align="center">



https://github.com/user-attachments/assets/ed7b1a9d-724c-48a9-ab49-3d51deea863e



</p>

*Promo film. App screens were captured from the current build; the smart-glasses scene is our vision with Meta, not a shipped feature. For the unedited, Meta-backed run, see the [demo video](#demo-3-minutes).*

**Built during the hackathon.** Everything in this repository was written during the Meta Global AI Developer Hackathon building period, Oct 27 – Nov 4, 2026. The first commit is from Oct 27, and the [commit history](https://github.com/whwan4570/driveAI/commits/main) shows the rest. Meta's models, the 2014 Sonata owner's manual and the public data sources listed [below](#supported-car-and-data-sources) are the outside pieces we used.

## The problem

There is a moment every car owner knows.

The hood is up. The light is going. And the machine you trust with your life every day — the one that took you to work, to the hospital, home for the holidays — is suddenly a stranger. You are standing in front of it, a bottle in one hand and a guess in the other, realizing you don't actually know your own car.

Everything you need exists. It's just never there when you need it.

**The knowledge** is in a manual written for everyone — which means it was written for no one. Not for your model. Not for your engine. Not for this cap, in this light, right now.

**The help** assumes you have a free hand. You don't. Both of yours are holding the job — the cap, the bottle, the work itself. Every tutorial ever made asks you to stop doing the thing in order to learn the thing.

**The check** is nobody's job. The wrong bottle looks exactly like the right one — until coolant is in the washer tank, and a five-minute task becomes a repair bill.

**And the record** — the record is memory. Receipts fade. Memory fades faster. A year from now, no one will know what was done, or when, or whether it was done at all.

So we postpone. We pay strangers for things our own hands could do. We guess, and we forget. And a small, doable act of care becomes one more thing we meant to get to.

## Our solution

**Carmori stands in that moment with you.**

It is an AI companion for the car you actually own — not cars in general, yours. It knows your model and your manual. It watches through your camera while your hands stay on the work. It checks every step before it lets you move on. And when you're done, it remembers — so you never have to.

Each feature answers one of the four problems.

**The knowledge — written for your car, not for everyone.**

- **Meet your car.** Scan the VIN plate, photograph the car, or upload the bill of sale. Carmori reads it once and knows which car is yours — then lets the VIN and the document go. Every answer after that starts from your exact car.
- **Hear your car.** One tap, and Carmori tells you how your car is doing: what was done, what's due, what last week's rain asked of it — and what it honestly doesn't know yet.
- **Ask your car.** Talk to Muse by voice or text. It answers from your car's manual and records. When the record is silent, so is it.
- **Buy the right bottle.** The shelf doesn't know your winter. Carmori checks the coming cold and tells you which freeze rating will hold.

**The help — guidance that never asks for your hands.**

- **A guide that watches.** Mount the phone and work. Carmori sees each step through the camera and speaks the next one. You never touch the screen.
- **A voice instead of a tap.** Ask in the middle of the job. You speak; the work continues.
- **Tires, wheel by wheel.** Walk around the car and hold the phone still. Carmori captures the sidewall and the tread of each tire on its own — eight views, no buttons.
- **Help beyond the hood.** Gas, repairs, car washes and parts stores are one tap away. When you forget where you parked, Find my car points you back. And when CarPlay or Android Auto connects, Carmori can greet you with your car's briefing.

**The check — finally, someone whose job it is.**

- **Two eyes before every step.** The AI never decides alone. Two separate camera observations must agree before any step advances. When the view is unclear, it waits — the way a careful friend would.
- **The wrong bottle stops everything.** Show coolant, oil or a coffee cup, and pouring stays locked — because some mistakes you only get to make once.
- **No blurry evidence.** The tire check turns away the blurry, the dark and the crooked. Hold up a tread gauge, and Carmori reads the number — but you confirm it before it counts.

**The record — memory that doesn't fade.**

- **Every job remembers how it was done.** Each record is stamped with its source: seen on camera, or confirmed by you.
- **Know what's due.** Status keeps every part in one place — washer fluid, tires, oil, brakes, filters, belts — with what was done, when, and what to look at next.
- **Keep it all in the glove box.** Insurance and registration with renewal reminders, and a care history of every confirmed job, with photos, as a list or a calendar.

**One job, all four answers.** The first complete job — a washer-fluid refill on a 2014 Hyundai Sonata — brings them together:

1. **Find.** There it is — the cap, marked in your camera view. It was always there. You just needed someone who knew your car to point.
2. **Open.** Both hands on the cap. You never touch the phone. The guide sees it happen and moves on by itself.
3. **Check.** Show the bottle. If it isn't washer fluid, everything stops.
4. **Pour. Close.** Carmori watches the pour, and waits until it sees the cap closed. It claims only what it actually saw.
5. **Remember.** The refill is saved with how it was confirmed. Days later you can ask, "What did I just do?" — and it answers from the record, not from a guess.

Carmori doesn't do the work for you. It makes sure you're never alone while you do it.

## Meta technology we used

We didn't use four Meta models because we could. We used them because that moment in front of the open hood demands four different kinds of attention.

**Muse Spark 1.3** is the attention of someone standing beside you. It watches the live camera two frames at a time — finds the cap, reads the label, checks a tire, reads a VIN plate. And when you ask it a question, it answers only from your car's own records. If it doesn't know, it doesn't invent. That restraint is the feature.

**Muse Voice Transcribe 1.0** is listening, so your hands don't have to stop. You speak; the work continues.

**SAM 3.1** studies what already happened — segmenting and tracking the cap, the bottle, the inlet in uploaded clips. It doesn't drive the live guide, and we won't claim it does.

**SAM 3D** gives the car back to you. The Sonata on Home is a SAM 3D model, generated from a photograph — your car, present on the screen the way it's present in your life.

Every confirmed step in the guide is a real Spark response. Every simulated one is labeled **Demo Mode**. We labeled them because trust is the whole product: a companion that exaggerates what it saw would be worse than no companion at all.

Technology is usually measured by what it can do. We would rather be measured by what it noticed: a cap, a label, a pair of busy hands — and a small job, done right, by the person who owns the car.

*Model-by-model scope: [How the Meta AI components fit together](#how-the-meta-ai-components-fit-together).*

---

**Live prototype:** [Open Carmori](https://driveai-ni3a.onrender.com/) on a phone or desktop. The hosted HTTPS app needs no local setup; allow camera and microphone access to try the guides. The [local setup](#run-it-locally) below is for development and reproduction.

**[Demo video](#demo-3-minutes) · [Meta model roles](#how-the-meta-ai-components-fit-together) · [Scope decision and architecture](#deliberately-deferred-streaming-sam-and-spatial-ar) · [Tests](#tests)**

## What judges can verify

| Rubric | Evidence in this prototype | Where to look |
| --- | --- | --- |
| **Impact (30%)** | A complete owner journey, from a vehicle-specific question to a hands-free refill and a saved record. | [Demo video](#demo-3-minutes), [supported car and sources](#supported-car-and-data-sources) |
| **Use of Meta AI Tooling (25%)** | Muse Spark interprets live camera observations and product labels; Muse Voice Transcribe handles spoken input. Home shows a team-supplied SAM 3D result for the demo Sonata. SAM 3.1 can segment an uploaded clip but does not drive the live overlay. | [Model roles](#how-the-meta-ai-components-fit-together), [3D scope](#deliberately-deferred-streaming-sam-and-spatial-ar) |
| **Technical Depth & Execution (20%)** | A deterministic state machine requires two disjoint observations, rejects stale responses and incompatible products, and records whether completion was observed or user-confirmed. | [Decision rules](#how-the-hands-free-refill-decides), [replay tests](#tests) |
| **Demo (25%)** | The camera view shows the cap cue, a no-tap step change, uncertainty handling, voice interaction, and the resulting care-history record. | [Demo video](#demo-3-minutes) |

The live video should show the **camera scene and the app screen together** at the no-tap transition. A simulated run must be labeled **Demo Mode**; it is not evidence of a successful Meta-backed camera run.

**Stage One proof:** Run with a valid server-side `META_API_KEY` and `CARMORI_SPARK=meta`. The automatic transition response includes `model_version` and `simulated: false`; the guide's evidence card shows the model and the observed condition. Never include the API key in a recording or submission. [`spark.py`](backend/carmori/spark.py) makes the Meta calls; [`main.py`](backend/carmori/main.py) creates the transition event.

## Long-term vision

Car ownership is more than driving. Maintenance history lives in receipts, warnings in the dashboard, instructions in a manual, and the next task on a to-do list. Carmori brings those fragmented moments together so owners can **understand their car, get help while doing the work, and keep a trustworthy record of what happened**.

Our long-term vision is an AI companion for **the car you actually own**, not a generic chatbot or another maintenance reminder app. Carmori should recognize the vehicle and its context, remember its history and the owner's preferences, make everyday driving and care easier, and eventually guide people directly over real vehicle components through spatial augmented reality.

### The ownership experience we want to build

| Pillar | Long-term experience |
| --- | --- |
| **Vehicle Memory** | One evolving history of mileage, service receipts, photos, repairs, oil changes, washes, vehicle documents, and owner preferences. |
| **Proactive Companion** | Briefings and conversational answers grounded in vehicle history, maintenance schedules, weather, and relevant driving context. |
| **Visual & AR Garage** | Camera-guided care today; component-aware, spatially anchored instructions on the real car as recognition and tracking mature. |
| **Everyday Discover** | Useful services, parking memories, nearby stops, and suggestions that relate to the owner's vehicle and routine. |

The intended loop is **Know the car → Understand the need → Guide the action → Remember the result**. The experience should become more useful as the vehicle's memory grows.

### Why a washer-fluid refill for a three-minute demo?

A fully generalized automotive assistant would require vehicle-specific data across many models, robust real-world perception, calibrated 3D geometry, spatial tracking, and extensive safety validation. Those systems cannot all be built and validated in a short hackathon.

We chose **one complete, hands-free care journey** on a **2014 Hyundai Sonata** instead: a useful briefing, a grounded question, a camera-guided refill, and an answer that uses the newly saved record. This scenario makes the connection between **vision, voice, workflow decisions, and long-term memory** visible within three minutes.

**Brief → Ask → Inspect → Refill → Remember**

Built for the Meta Global AI Developer Hackathon 2026. The live refill path uses **Muse Spark 1.3** for camera observations and **Muse Voice Transcribe 1.0** for speech. A separate **SAM 3.1** endpoint analyzes uploaded short clips; the live arrow uses on-device image matching. Home displays a **team-supplied SAM 3D result for the 2014 Sonata**. We deliberately deferred streaming SAM, automatic SAM 3D generation for arbitrary vehicles, and native spatial AR so we could validate the complete hands-free task first. [The scope decision and integration paths are below.](#deliberately-deferred-streaming-sam-and-spatial-ar)

---

## What it does

| Area | What the user gets |
| --- | --- |
| **Add your car** | The first screen: scan the VIN plate, photograph the car, upload a bill of sale, buyers guide or window sticker, or enter the details yourself. Photos go to Meta for one-time reading; Carmori does not save the VIN or the document. |
| **Home** | A 3D view of the car, the last recorded odometer, **Hear your car summary** and suggested checks. The summary is a spoken briefing built from saved records, rain over the past 7 days and care rules; each item shows why it matters and what is still unknown. The demo Sonata uses the team's SAM 3D-derived GLB; other vehicles use their own supplied model or a generic fallback. |
| **Muse** (top bar) | Ask by voice or text. Answers come from stored facts only. If the model cannot point to a fact, Carmori does not read the answer out. |
| **Guide → Washer fluid** | A setup screen, then a full-screen camera guide: find the inlet, lift the cap, show the bottle, pour, close. Cards and cues appear inside the camera view. A washer-fluid item in Home's suggested checks opens the same guide. |
| **Guide → Tire visual check** | An 8-shot visual check (sidewall and tread on each wheel). It rejects blurry, dark or wrong-angle shots. Muse can read a photo of a tread-depth gauge, and you confirm the reading before it is used. Carmori never measures tread depth or pressure from the tire itself. |
| **Status** | Care status and service history per part, plus driving details (tracked mileage, highway share, rain over 7 days). |
| **Need washer fluid?** | Shopping help that matches the freeze rating to the forecast low, opened from suggested checks, Status or the washer guide setup. |
| **Places** | Google Maps shortcuts for gas stations, repair shops, car washes and auto parts stores, your saved stops, and the parked-car spot with a Find my car compass view. |
| **Glove box** | Driving documents (kept in this browser) and the care history: user-confirmed records with photos, in a list or calendar. |
| **In the car** | In the iOS and Android shells, the briefing can start when CarPlay or Android Auto connects. |

## How the Meta AI components fit together

| Component | Responsibility in Carmori | Scope in this prototype |
| --- | --- | --- |
| **Muse Spark 1.3** | Interpret camera observations and maintenance photos; support contextual, grounded responses. | Short two-frame windows and image checks feed backend validation rules. |
| **Muse Voice Transcribe 1.0** | Convert spoken questions or requests into input the assistant can act on. | Voice transcription is integrated with a browser/optional voice-service path; voice alone never certifies a safety-critical visual step. |
| **SAM 3.1** | Segment and track selected objects such as the cap, bottle, or washer inlet across an uploaded video clip. | A separate short-clip mask/tracking endpoint. It does not drive the live arrow or complete a workflow step. |
| **On-device visual tracking** | Follow a Muse-verified point as the phone moves and update the cue and the next camera crop together. | Local browser image matching, not SAM or 3D AR. The cue disappears if matching fails; Muse must relocate the target. |
| **Carmori backend and vehicle memory** | Determine workflow transitions, reject unsafe or unsupported conclusions, store evidence-backed maintenance records. | FastAPI state machine, vehicle-specific owner-manual guidance, records, and replay tests. |

**Why separate model perception from workflow decisions?** A visual model can describe what it sees, but maintenance actions need predictable guardrails. Carmori requires agreeing observations, waits when the view is blocked, rejects the wrong product, and records whether an action was visually observed or confirmed by the user. The model provides observations; application logic controls progression.

**The Meta-backed path:** phone camera → Muse Spark scene fields → server validation and state transition → on-screen/voice instruction → evidence-backed care-history record. A successful automatic transition returns the previous and next steps, condition, observation and frame IDs, model version, decision time, and measured model processing time. The UI shows a confirmation only after that server event. [Backend transition code](backend/carmori/main.py) and [guide UI](web/src/screens/Work.tsx) implement this boundary. In `fake` mode, the event and UI say **Simulated observation**.

### How the hands-free refill decides

The phone sits on a mount and keeps sending short two-frame windows. Muse Spark describes each window, and a server state machine, not the model, decides the step:

```
FIND_INLET → OPEN_CAP → CONFIRM_PRODUCT → POUR → FINISH → RECORDED
```

- A step advances only when **two separate observations agree**.
- **UNKNOWN means wait.** If the cap is blocked, the label can't be read or the pour is hidden, Carmori holds the step and says why.
- **Voice cannot approve** a product or an inlet that the camera has not confirmed.
- **A wrong product stops the flow:** "This isn't washer fluid. Show a washer-fluid bottle before pouring." (for example coolant or a coffee cup).
- **Finishing needs a closed cap in view.** After the pour, Carmori saves the record only when it sees the cap closed.
- **A late answer can't skip ahead.** Old answers are dropped by sequence number and state version.
- **Records say where they came from.** A refill seen on camera is saved as `observed_sequence`. If the pour was hidden, Carmori asks, and saves `user_voice_confirmed` only after you say yes.
- Carmori never estimates the fluid level or how much you poured.

---

## Demo (3 minutes)

[demo-video]

This is a **vertical slice of the longer-term Carmori experience**, not a claim that every vehicle or maintenance task is supported today. The story starts with what the car knows, moves into a physical task, and ends with a new memory the assistant can recall.

**What to watch for:** the assistant grounds its advice in records; Muse observations inform a hands-free task; the controller validates progression; and the final answer reflects the saved maintenance event. Keep the user's hands and the app screen visible together when the cap opens. Show the model-backed run, not a replay or Demo Mode, as proof of automatic recognition.

### Before you start

- Engine off and cool, hood open, car parked.
- Phone on a stable mount with the engine bay in view, in good, even light. The initial cap search is automatic; if recognition is uncertain, move the phone as directed rather than claiming a successful detection.
- A real washer-fluid bottle with a readable label. If you show coolant or oil, only show the label. Never pour it into the washer tank.
- Backend running with `META_API_KEY`. The top bar shows **Demo Mode** when step checks are simulated. Don't present Demo Mode as real camera recognition.
- The car is registered as **2014 Hyundai Sonata**, so the Sonata guide is used.
- Camera, microphone and location are on in **Menu → Settings**.

---

## Why this prototype is scoped this way

The three-minute format pushed us to prioritize **an end-to-end interaction that can be explained and tested** rather than a broad collection of unfinished experiences.

- **Vehicle-specific first:** We use a 2014 Hyundai Sonata and its owner's manual so task instructions can be checked against a concrete car. Extending the same quality to many models requires more verified vehicle data.
- **Reliable transitions before unlimited autonomy:** A state machine decides the next step from model observations and rules. The system explicitly handles uncertain frames, incompatible products, and late responses rather than treating every model output as an instruction.
- **Evidence before claims:** Replay tests cover scripted edge cases. Real-car accuracy, timing, and mount robustness are **not yet established as repeatable metrics** and require the documented real-clip test set plus multiple uninterrupted phone runs. Simulated step checks are identified as **Demo Mode** when used.

### Deliberately deferred: streaming SAM and spatial AR

We **deliberately deferred these integrations** for the three-minute prototype. Their service and app boundaries are designed, and initial adapters exist. Bringing them into the demo would require a dedicated GPU environment, asset conversion or device calibration, plus another real-car validation path. We chose to focus the hackathon validation on the central interaction: Muse observes the cap opening, the server advances without a tap, and the result becomes a record.

| Capability | Already in the repository | Integration path we designed | Why it is outside this demo |
| --- | --- | --- | --- |
| **Streaming SAM 3.1 tracking** | A [short-MP4 SAM endpoint](backend/carmori/sam_video.py) returns masks and request-scoped track IDs; the live guide uses [local image matching](web/src/lib/localVisualTracking.ts) to move its cue and Muse crop together. | Seed SAM from a Muse-verified frame, stream subsequent frames to a persistent tracker, align each result to its capture time, and hide/reseed the cue when the target is lost. | The uploaded-clip endpoint cannot supply low-latency, frame-aligned live positions. We have not deployed or measured a streaming tracker on a phone-to-GPU connection. |
| **Automatic SAM 3D generation** | The team supplied a SAM 3D-derived [`demo.glb`](web/public/models/demo.glb), which [Home loads for the 2014 Sonata](web/src/components/StatusVehicle3D.tsx). A separate [GPU-stage script](services/sam3d/generate_splat.py) prepares a splat PLY from a vehicle cutout. | For each new vehicle, run SAM 3D Objects on a Linux/NVIDIA worker, inspect and convert its output into a viewer-ready GLB, then store and attach it to that vehicle. | The bundled Sonata asset is shown now; the automatic per-vehicle GPU job, conversion and publishing pipeline have not been validated. Those steps add cost and waiting time without improving the washer-cap decision. |
| **World-anchored AR** | [iOS and Android shells](web/) exist; the current guide is a 2D camera overlay that follows local image matching. | Use native ARKit/ARCore camera pose and anchors with a verified component location, then test alignment across motion, occlusion and different cars. | A 3D vehicle model does not by itself locate a physical cap. Native anchoring and real-car calibration would expand the demo beyond its tested workflow. |

The proposed deployment separates the web/API service from the GPU worker; the existing Capacitor shells provide a path to native iOS/Android delivery. The detailed service boundaries, data flow and validation gates are in [the original integration design (a proposal, not a current-status report)](docs/CARMORI_INTEGRATION_DESIGN.md) and [the SAM 3D stage notes](services/sam3d/README.md). The Sonata asset was supplied as a SAM 3D result and is displayed on Home; the repository does not contain its source image, generation manifest or checkpoint, so its creation cannot be reproduced from this repository alone. The refill arrow is **not** a SAM mask or world anchor. Only the bundled Sonata display is counted as working here, not automatic SAM 3D generation for every registered car.

### Next engineering milestones

1. **Real-car validation:** Measure recognition accuracy, latency, false transitions, and performance under varying light, occlusion, and camera angle.
2. **Streaming tracking:** Connect a persistent SAM 3.1 service only after measuring end-to-end frame latency against on-device matching and testing target loss/reseed.
3. **3D assets and spatial AR:** Make the team-supplied Sonata asset reproducible through a GPU job and reviewed GLB export for new cars; separately test ARKit/ARCore anchors against the real car. A generated vehicle asset is not a physical component anchor.
4. **More vehicles and tasks:** Add vehicle-specific manuals, workflows, and validated safety checks beyond the initial Sonata refill.
5. **Deeper ownership memory:** Link maintenance, documents, trip context, personalized care, and the proactive companion into one continuous experience.

---

## Run it locally

For the hosted prototype, use the [live Carmori URL](https://driveai-ni3a.onrender.com/). These steps are for running or modifying the repository on your own machine.

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

### Deploy on Render

[`render.yaml`](render.yaml) runs everything as one web service. FastAPI serves the built web app at `/` and the API at `/api`, so there is one HTTPS address and no CORS or proxy setup. Phones can use the camera there without installing a certificate.

1. In Render, choose **New → Blueprint**, then pick this repository.
2. Enter `META_API_KEY` when asked.
3. Deploy, then open your Render service URL. The current public deployment is [driveai-ni3a.onrender.com](https://driveai-ni3a.onrender.com/).

The Blueprint uses the paid **Starter** plan and a 1 GB disk at `/var/data`. Render bills both by the time used. The disk keeps SQLite, downloaded manuals and 3D models through deploys and restarts, and Starter does not sleep. On the free plan the server sleeps after 15 minutes idle and loses saved data on restart. Switch the plan back and remove the disk when the demo is over.

To run the deployed setup locally after `pnpm build` in `web/`:

```bash
cd backend
.venv/bin/uvicorn carmori.site:create_site --factory --port 8000
```

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
- **Vehicle data:** NHTSA vPIC for VIN decoding and the make/model list.
- **Places:** the optional place-visit prompt looks up nearby gas stations, repair shops and car washes in OpenStreetMap (Overpass). The Places shortcuts open Google Maps searches.
- **Car photo:** a 2013 Sonata GLS photo under CC BY-SA 4.0 ([credits](web/public/CREDITS.md)).

---

## Tests

```bash
cd backend
.venv/bin/pytest -q
.venv/bin/carmori-replay ../fixtures/clips
```

`carmori-replay` runs the state machine over 16 scripted clips: a normal refill, flicker, a blocked view, a wrong bottle, a bottle swap, an empty-bottle pour, late and out-of-order answers, and voice trying to approve a product. It fails on any wrong record. CI runs both, plus `pnpm build`.

### D7 verification snapshot · 2026-11-03

| Check | Result | What it proves |
| --- | --- | --- |
| Backend tests | **177 passed, 1 skipped** | The current automated backend suite passes. |
| Scripted workflow replay | **16/16 clips passed; 0 wrong automatic records** | The state machine handles the scripted normal and failure cases. This is not a real-car success rate. |
| Real-car, uninterrupted phone runs | **Not scored yet** | Attempt count, no-tap completion rate, false transitions and first correct cap-cue time still need a measured run. |

**Submission wording template — example numbers only, not D7 findings:** “In **5** real-car attempts, **4/5** reached a saved record without a screen tap, with **0** false transitions; the median time to the first correct cap cue was **8.0 s**.” Replace all four example values with measured results from uninterrupted phone runs tonight before using this sentence in a submission. Keep failed attempts in the denominator and time the cue from opening the guide, not from the first model response.

**Real-clip test set:** [docs/REAL_CLIP_TEST_SET.md](docs/REAL_CLIP_TEST_SET.md) lists 12 cases (14 planned clips), including normal completion, occlusion, a coffee cup, a wrong fluid, a hidden label and an unseen pour. `python -m carmori.annotate --case <id>` asks the model once per frame window and saves the answers. `carmori-replay --report` then writes a results table, and rule changes can be re-checked with no API cost. The scripted fixtures above are **not** a measured real-car success rate. Before submission, report actual attempts, no-tap completions, false transitions and time to the first correct cap cue; do not infer these numbers from unit tests.

---

## API

Paths are relative to the API root. On the hosted site and through the Vite dev proxy that root is `/api` (for example `/api/health`); `carmori.main:app` run on its own serves them at `/`. FastAPI's interactive docs are at `/api/docs` on the hosted site.

| Route | Purpose |
| --- | --- |
| `GET /health` | Model name, Demo Mode and vision status |
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

## Current prototype limitations

- **Real-world accuracy is not proven yet.** The replay clips are scripted. Step accuracy, delay and mount position still need the real-clip test set and full runs on the car.
- Photo checks (inlet, label, tire) take several seconds each. Live step checks depend on network and model speed.
- Carmori does not measure fluid level, amount poured, tread depth or tire pressure. It shows what is visible and saves gauge readings you enter.
- The inlet cue follows local image matching while the target remains visible. Fast camera movement, occlusion and a changed cap appearance can force a new Muse search. The [streaming SAM and spatial AR plan](#deliberately-deferred-streaming-sam-and-spatial-ar) is intentionally outside this demo.
- SAM 3.1 track IDs last only for one uploaded clip request. The Sonata's bundled SAM 3D-derived GLB displays on Home, but the [automatic generation and publishing path](#deliberately-deferred-streaming-sam-and-spatial-ar) has not been run end to end in this repository.
- Without a working Meta key (billing or model access), photo checks, automatic steps and transcription are unavailable. The app says so and never records a step it didn't see. Manual records still work.
- There are no accounts. The browser remembers the car ID in `localStorage`, and the hosted demo has no sign-in or ownership checks, so don't enter personal data there. Add sign-in and ownership checks before real owners rely on it.
