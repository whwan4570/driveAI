

https://github.com/user-attachments/assets/e234ab73-7eac-4afe-a837-9550db998467

# Carmori

**A hands-free AI car-care companion that helps you complete a maintenance task and remembers what happened.**

Built for the **Meta Global AI Developer Hackathon (October 27–November 4, 2026)**. Carmori combines Meta's multimodal models with a rule-based workflow controller and vehicle-specific maintenance history. See the [commit history](https://github.com/whwan4570/driveAI/commits/main) for development activity.

**[3-minute demo](#demo-3-minutes) · [Live prototype](https://driveai-ni3a.onrender.com/) · [How it works](#how-the-meta-ai-components-fit-together) · [Tests](#tests) · [Run locally](#run-it-locally)**

## Demo (3 minutes)

https://github.com/user-attachments/assets/5f66cca0-79f9-45a5-81d3-e51140686d03

**[Watch in full quality on YouTube](https://youtu.be/ciQin_Bnydw)**

The demo follows one maintenance task on a **2014 Hyundai Sonata**: review the car's information, ask a question, use the camera-guided washer-fluid refill, and save the completed task to vehicle history. The goal is to demonstrate an end-to-end experience, not claim support for every car or repair.

**Live demo vs. concept:** This [promotional video](https://github.com/user-attachments/assets/ed7b1a9d-724c-48a9-ab49-3d51deea863e) includes a smart-glasses concept scene. AI-glasses integration and world-anchored AR are future work, not features in this prototype. The app labels simulated camera checks **Demo Mode**. An actual model-backed run requires Meta API access.

## The problem

Owning a car means keeping track of maintenance, renewal dates, documents, and past work, then deciding what to do next. Carmori is designed for owners who want those responsibilities connected to their own vehicle and explained in plain language.

| Ownership problem | Published evidence | Connection to Carmori |
| --- | --- | --- |
| Keeping maintenance on schedule | In November 2024, CARFAX estimated that more than 30 million U.S. vehicles were overdue for both oil changes and tire rotations. [CARFAX release](https://www.prnewswire.com/news-releases/carfax-millions-of-cars-are-alarmingly-behind-on-maintenance-302314731.html) | Status and service history bring available manual guidance and past maintenance together to help owners review what is due. |
| Remembering vehicle deadlines | Lloyds reported in June 2026 that 21% of UK drivers had forgotten essential vehicle-admin dates, including inspections (MOT), tax, or insurance. [Lloyds research](https://www.lloydsbankinggroup.com/media/press-releases/2026/lloyds/drivers-can-avoid-costly-penalties-with-new-in-app-car-admin-too.html) | Glove box groups saved driving documents and renewal dates for review. |
| Managing scattered information | The same Lloyds research found that more than half used at least three apps or providers to manage aspects of running their car. [Lloyds research](https://www.lloydsbankinggroup.com/media/press-releases/2026/lloyds/drivers-can-avoid-costly-penalties-with-new-in-app-car-admin-too.html) | Vehicle records, documents, briefings, and questions share one ownership context. |
| Feeling confident doing simple tasks | In a 2026 MoneySuperMarket survey of 2,000 UK drivers, 29.5% cited fear of mistakes or vehicle damage as a reason to avoid DIY maintenance; 29.8% had sought professional help to check or top up washer fluid. [Survey and methodology, April 27–May 1, 2026](https://www.moneysupermarket.com/car-insurance/should-i-fix-it/) | Camera and voice guidance help an owner follow the washer-fluid task and retain a record of its completion. |

These sources describe different populations and measures: a CARFAX estimate and UK self-reported survey findings. They establish ownership problems, not Carmori adoption, a combined market size, or measured benefits from this prototype.

Car manuals and repair videos can explain a task, but they cannot see the part in front of you or check whether you completed a step correctly. This is especially inconvenient when both hands are occupied. Carmori connects the broader management experience to that moment of action: review the car's records, guide a physical task using camera observations and voice, then save what was confirmed for the next interaction.

## What we built

- **Vehicle-specific assistance:** Add a car using a VIN photo, vehicle photo, document, or manual entry. Ask questions grounded in the car's available information and saved records.
- **Hands-free washer-fluid guide:** A phone camera follows `FIND_INLET → OPEN_CAP → CONFIRM_PRODUCT → POUR → FINISH → RECORDED`, with on-screen cues and spoken assistance.
- **Evidence-based step changes:** The FastAPI workflow controller advances only after two separate, non-overlapping visual observations agree. Unclear frames, wrong products, and stale responses do not count as a completed step.
- **Maintenance memory:** Save a completed refill with the source of confirmation, distinguishing `observed_sequence` from `user_voice_confirmed` or a manual entry. Carmori can reference the saved event later.
- **Additional prototype features:** An eight-view tire visual check, service history, owner briefings, nearby car-care links, a glove-box view, and a 3D view of the demo vehicle.

## How the core workflow works

```text
Phone camera → Muse Spark 1.3 → structured scene observations
                                     ↓
                           FastAPI state machine
                           checks agreement, order,
                           product, and visibility
                                     ↓
                       Next instruction / completion
                                     ↓
                     Evidence-backed maintenance record

Spoken input → Muse Voice Transcribe 1.0 → voice actions
             (cannot override visual safety checks)
```

The model identifies what appears in the scene; **application logic decides whether the next step is allowed**. The controller requires two independent observations, rejects old or reused frames, and waits when the evidence is uncertain. If the pour is not visible, a confirmed record is labeled differently from a visually observed completion. See the [state machine](backend/carmori/state_machine.py) and [replay tests](#tests).

## Meta AI used

| Technology | What it does here | Scope |
| --- | --- | --- |
| **Muse Spark 1.3** | Interprets camera frames, product labels, vehicle details, and grounded questions. | Its observations are validated by the server; model text alone never advances a maintenance step. |
| **Muse Voice Transcribe 1.0** | Converts spoken input for hands-free use. | Voice commands do not certify an inlet or an unsafe product. |
| **SAM 3.1** | Segments and tracks a selected cap, bottle, or inlet in an uploaded short video. | Separate clip-processing endpoint; **not** the live camera overlay. |
| **SAM 3D** | A team-supplied, SAM 3D-derived GLB is displayed for the demo Sonata. | Automatic per-vehicle generation is **not** implemented end to end. |

The live 2D guidance cue uses local browser image matching between Muse checks, not streaming SAM or spatial AR. See the [component-by-component architecture](#how-the-meta-ai-components-fit-together).

## Evidence for judges

| Area | What can be inspected | Evidence |
| --- | --- | --- |
| **Usefulness** | A vehicle-specific question, guided refill, and newly saved service record. | [Driver survey and problem](#the-problem), [three-minute demo](#demo-3-minutes), [early real-car evidence](#early-real-car-evidence-and-scale), [supported car](#supported-car-and-data-sources) |
| **Meta model integration** | Muse Spark camera analysis, Muse Voice transcription, SAM 3.1 clip endpoint, and the supplied SAM 3D vehicle asset. | [Architecture](#how-the-meta-ai-components-fit-together), [integration scope](#deliberately-deferred-streaming-sam-and-spatial-ar) |
| **Technical execution** | Independent-observation gate, product checks, out-of-order response handling, and provenance-aware records. | [State machine](backend/carmori/state_machine.py), [tests](#tests) |
| **Demo** | The camera guidance and step transitions in the washer-fluid workflow. | [Demo video](#demo-3-minutes), [demo setup](#demo-setup) |

**Verification boundary:** Automated tests and scripted replays exercise the rules, not real-car recognition. Our [early real-car results](#early-real-car-evidence-and-scale) are team-reported, single-car observations, not a cross-vehicle success rate. The [test snapshot](#tests) separates those results from scripted checks. For a Meta-backed run, the backend must have a valid `META_API_KEY`; `CARMORI_SPARK=meta` enables model-backed observations and `simulated: false` marks the non-demo transition. Without access, the app labels simulated checks rather than presenting them as real detections.

## Early real-car evidence and scale

**Scale is a potential, not a user count.** The U.S. Federal Highway Administration counted **239.8 million licensed drivers** and **297.5 million registered motor vehicles** in 2024 ([driver table](https://www.fhwa.dot.gov/policyinformation/statistics/2024/dl1c.cfm), [vehicle table](https://www.fhwa.dot.gov/policyinformation/statistics/2024/mv1.cfm)). These are broad context figures, not Carmori users or an estimate of people who would use this guide. We start with one simple care job on one verified car. The guide's observation rules and record format can be reused, while each additional vehicle and task needs its own checked manual guidance and real-car testing. **Only the 2014 Sonata has vehicle-specific washer guidance in this prototype.**

**Evidence as of Nov 4, 2026:**

| Evidence | What happened | Limit |
| --- | --- | --- |
| Real-car phone use | Before the inlet-search changes, the team reports the washer cap was detected in **0 of 5** attempts. On the updated build, **4 of 4** full, no-touch washer-guide attempts completed on its 2014 Sonata. | Team-reported attempts without timestamped logs. The earlier result measures cap detection; the later result measures full completion. These are not a controlled before/after accuracy test. |
| Real engine-bay images | Muse Spark returned a visually correct washer-cap location in **2 of 2** supplied photos of the same Sonata. The model calls took **2.8 s** and **4.0 s**. | Still-image spot checks, not end-to-end phone latency or performance across cars and conditions. |
| Early hands-on feedback | A user reported uncertainty about finding the inlet and unreliable detection. We changed the guide to search the whole engine bay automatically, give movement guidance, and re-search after camera movement. | We have no counted post-change study with that user. |
| Scripted regression | **16 of 16** workflow replays passed with **0 wrong automatic records**. | Scripted cases test decision rules, not real-car recognition accuracy. |

**What changed after those five failed detections:**

1. The guide searches the whole engine bay automatically, then checks the lower corners if needed. A moving camera no longer leaves it waiting forever; a new view triggers another search.
2. Muse checks the washer symbol **or** the cap together with its narrow filler neck. Blue color helps find a candidate but cannot verify the cap by itself; coolant, oil and other caps are excluded.
3. Two distinct camera frames are checked in parallel. The cue appears only when both identify the same cap, and local image tracking carries that verified point to the current view; a lost point is hidden and searched again.
4. Inspection calls use `low` reasoning and a 1280 px search image to reduce waiting. The **2.8 s** and **4.0 s** figures above are model-call times, not total guide time.

The **0/5** and **4/4** observations show why we changed the guide and that the revised demo now completes, but they measure different outcomes under unlogged conditions. We do not claim an improvement percentage. Future field tests should log every phone attempt, including failures, and measure wrong transitions and time from opening the guide to the first correct cap cue. Four completed runs on one car do not establish performance across vehicles, users, or conditions.

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

**Architecture principle:** Muse provides scene observations; the backend validates them before updating the workflow. The app records whether completion was visually observed or explicitly confirmed.

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
| Real-car, uninterrupted phone runs | **Not scored on Nov 3** | The team-reported Nov 4 attempts appear in [early real-car evidence](#early-real-car-evidence-and-scale). |


**Real-clip test set:** [docs/REAL_CLIP_TEST_SET.md](docs/REAL_CLIP_TEST_SET.md) lists 12 cases (14 planned clips), including normal completion, occlusion, a coffee cup, a wrong fluid, a hidden label and an unseen pour. `python -m carmori.annotate --case <id>` asks the model once per frame window and saves the answers. `carmori-replay --report` then writes a results table, and rule changes can be re-checked with no API cost. The scripted fixtures above are **not** a measured real-car success rate. Broader real-car performance, false-transition counts, and first-cue times remain unmeasured; see the [Nov 4 field note](#early-real-car-evidence-and-scale).

---

## Long-term vision

Today's prototype is a phone-based, vehicle-specific maintenance guide with records. Over time, we want to extend the same approach to more vehicles, additional maintenance tasks, proactive owner assistance, and wearable interfaces. Component-aware instructions through AI glasses or spatial AR are **future directions**, not current functionality.
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

## Demo setup

### Before you start

- Engine off and cool, hood open, car parked.
- Phone on a stable mount with the engine bay in view, in good, even light. The initial cap search is automatic; if recognition is uncertain, move the phone as directed rather than claiming a successful detection.
- A real washer-fluid bottle with a readable label. If you show coolant or oil, only show the label. Never pour it into the washer tank.
- Backend running with `META_API_KEY`. The top bar shows **Demo Mode** when step checks are simulated. Don't present Demo Mode as real camera recognition.
- The car is registered as **2014 Hyundai Sonata**, so the Sonata guide is used.
- Camera, microphone and location are on in **Menu → Settings**.

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
