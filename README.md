# Carmori

손동작 기반 워셔액 보충 안내와 음성 차량 비서 MVP. Meta Global AI Developer Hackathon 2026.

**Brief → Ask → Inspect → Refill → Remember**

차 안에서 기록 기반 브리핑을 듣고 말로 질문한 뒤, 고정 거치한 휴대폰 카메라 앞에서 양손으로 워셔액을 보충하면
화면 터치 없이 단계가 자동으로 넘어가고, 그 작업이 다음 대화의 차량 기억에 반영된다.

## 구조

```
web/        React + TypeScript (Vite). 카메라·움직임 게이트·VAD·TTS
backend/    FastAPI. 상태 머신·관찰 검증·중복 방지·브리핑·기억
fixtures/   리플레이 클립 (Spark 응답 캐시 + 정답)
```

### 관찰 루프: "멈춘 순간"에만 묻는다

```
[휴대폰]  ROI 저해상도 프레임 8fps ─▶ MotionGate (프레임 간 차이)
            움직임 → 0.7초 멈춤 = settled  /  4초 정적 = idle probe
              ▼
          겹치지 않는 묶음 2개 캡처 (A: 2장, 0.6초 뒤 B: 2장) ─▶ POST /sessions/{id}/observations
[서버]    두 묶음을 Spark에 동시에 질의 (현재 단계 항목만)
              ▼
          state_machine.transition()  ← 순수 함수
            - 같은 조건이 겹치지 않는 묶음에서 연속 2회일 때만 전환
            - 역순·오래된·다른 단계에 대한 응답은 버림
            - 손 접근·시간 경과로는 전환하지 않음
              ▼
          { current_step, transition_reason, spoken_hint, record }
[휴대폰]  바뀐 안내만 TTS (말하는 동안 VAD 정지, 끝나면 재개)
```

### 단계와 전환 근거

| 단계 | 넘어가는 조건 (2회 연속, 겹치지 않는 묶음) | 대기 |
| --- | --- | --- |
| FIND_INLET | 투입구 보임 + 기호 일치 + 캡 닫힘 | 가림, 다른 부품, 캡 이미 열림 |
| OPEN_CAP | 캡 열림 (손 접근은 무시) | 가림 |
| CONFIRM_PRODUCT | 라벨 판독 + 서버 규칙 MATCH | CONFLICT, UNKNOWN (음성 승인 불가) |
| POUR | 병이 입구 위에서 기울어짐, 흐름이 "없음"이 아님 | 가림 / 다른 병이면 제품 확인으로 복귀 |
| FINISH | 병 세움 + 캡 닫힘 | 흐름을 못 봤으면 "보충을 마쳤나요?" 음성 확인 |
| RECORDED | `observed_sequence` 또는 `user_voice_confirmed` | |

판정은 Spark가 아니라 서버가 한다. Spark는 단계별 객관식 항목(`prompts.py`)만 답하고,
제품 MATCH/CONFLICT/UNKNOWN은 `products.py`가 라벨 글자와 차량 사양으로 정한다.

## 실행

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
CARMORI_SPARK=fake .venv/bin/uvicorn carmori.main:app --reload --host 0.0.0.0
```

```bash
# web (다른 터미널) — https://<맥 IP>:5173 을 휴대폰에서 연다
cd web
pnpm install
pnpm dev
```

`CARMORI_SPARK=fake`는 현재 단계를 항상 통과시키는 가짜 모델이다. 판정 품질과 무관하게 웹·서버 통합을 먼저 진행하기 위한 것이다.

## 리플레이 하네스

실차 클립을 한 번만 Spark에 물어 캐시하고, 규칙은 API 비용 없이 반복 검증한다.

```bash
cd backend
.venv/bin/python -m carmori.replay ../fixtures/clips          # 전체
.venv/bin/python -m carmori.replay ../fixtures/clips -v       # 전환·안내 타임라인
.venv/bin/python -m carmori.replay ../fixtures/clips --agreements 1 --latency 4   # 규칙·지연 바꿔보기
.venv/bin/pytest -q                                           # 단위 테스트 + 모든 클립
```

실차 클립 추가 (Spark 연결 후):

```bash
ffmpeg -i cap_open_01.mp4 -vf fps=2 recordings/cap_open_01/%05d.jpg
CARMORI_SPARK=meta .venv/bin/python -m carmori.annotate ../recordings/cap_open_01 \
  --name cap_open_01 --final-step CONFIRM_PRODUCT --out ../fixtures/clips/recorded/cap_open_01.json
```

`annotate`는 단계와 무관하게 **모든 항목**을 묻는다. 그래야 규칙을 바꿔도 같은 캐시로 다시 돌릴 수 있다.
`--final-step`·`--completion-source`는 사람이 영상을 보고 정한 정답이다.

현재 `fixtures/clips/`의 13개는 계획서의 필수 실패 사례(손만 접근, 다른 병, 빈 병·붓는 척, 캡 미닫힘,
가림, 역순·지연 응답, 판단 흔들림, 겹친 프레임, 음성으로 제품 승인 시도)를 손으로 만든 합성 클립이다.
실차 클립이 쌓이면 `source: "recorded"`로 구분한다.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/vehicle-specs` | 지원 차량 목록 |
| POST | `/vehicles` | 차량 등록 (+ 마지막 보충일은 `manual_entry` 기록) |
| GET | `/vehicles/{id}/memory` | 작업 이력 |
| POST | `/briefings` | 기록 기반 브리핑 (lat/lon 주면 Open-Meteo 포함) |
| POST | `/assistant/ask` | 질문. "아까 뭐 했지?"류는 기록 조회, 나머지는 근거 사실 id 검증 |
| POST | `/sessions` | 작업 세션 시작 |
| POST | `/sessions/{id}/observations` | 프레임 묶음 1~2개 → 상태 전환 |
| POST | `/sessions/{id}/voice` | 음성 명령 (PAUSE, RESUME, REPEAT, RESTART, CONFIRM_YES/NO, EDIT_RECORD) |
| POST | `/voice/transcribe` | WAV → 텍스트 |
| POST | `/maintenance-records` | 수동 기록 |

## Day 1 TODO

- [ ] `vehicles.py` `DEMO_SPEC`: 시연 차량·연식·매뉴얼 항목·라벨 용어 확정
- [ ] `spark.py` `MetaSparkClient`: 행사 계정에서 엔드포인트·모델 ID 확인 후 이미지/오디오/텍스트 요청 구현
- [ ] Spark 1.3에 이미지 3~5장 보낼 때 지연·비용 실측 → `workSession.ts` 묶음 크기·간격 조정
- [ ] 실차 정상 클립 + 실패 클립 촬영 → `annotate`로 `fixtures/clips/recorded/` 생성
- [ ] 휴대폰에서 카메라+마이크 동시 사용, TTS 후 청취 재개, Wake Lock 확인
- [ ] `store.py` Supabase 구현 (`backend/supabase/schema.sql`), 근거 프레임 Storage 저장
- [ ] `briefing.py` `REFILL_CHECK_DAYS` 근거 확정

## 한계

고정 거치·지원 차량 1종·워셔액 보충 1개 작업에 한정한 프로토타입이다. 주입량·잔량·완전 밀폐·차량 정상 여부는
영상으로 확정하지 않으며, 관찰 기록과 음성 확인 기록을 구분해 저장한다.
