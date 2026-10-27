# Carmori — Beyond the Mileage

차량·운전 습관·정비 기록·실제 지역 강수량을 바탕으로 워셔액과 타이어 점검을 제안하는 모바일 웹앱입니다. React/Vite 프런트엔드와 FastAPI 백엔드를 유지하면서 SQLite 저장, Meta AI 호출, 카메라 작업 가이드를 연결했습니다.

## 로컬 실행

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn carmori.main:app --host 127.0.0.1 --port 8000 --env-file ../.env
```

```bash
cd web
npm install
npm run dev -- --host 127.0.0.1
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. 휴대폰 카메라·마이크 사용은 HTTPS가 필요합니다. 프런트엔드의 `/api` 요청은 Vite가 백엔드로 전달합니다. `npm run build`와 `backend/.venv/bin/pytest -q`로 확인합니다.

루트 `.env`에 `META_API_KEY`를 넣으면 서버는 기본적으로 Muse Spark 1.3의 이미지·텍스트 경로와 Muse Voice Transcribe 1.0의 음성 전사를 사용합니다. `META_API_BASE_URL` 기본값은 `https://api.meta.ai/v1`입니다. `CARMORI_SPARK=fake`를 명시하면 단계 판정을 **시뮬레이션**하며 화면에 Demo Mode로 표시됩니다. 이 모드는 실제 카메라 판정 품질을 검증하지 않습니다. `CARMORI_DB_PATH`를 설정하지 않으면 `backend/data/carmori.sqlite`에 저장합니다. API 키는 서버에만 둡니다.

현재 이 로컬 MVP에는 계정·사용자별 권한이 없습니다. 동일 브라우저는 `localStorage`에 차량 ID를 기억하고, 백엔드는 차량·정비 기록을 SQLite에 저장합니다. 공개 배포 전에는 인증과 소유권 검사가 필요합니다.

## 핵심 흐름

1. 처음 실행하면 VIN·외관·구매 문서 스캔 또는 수동 입력으로 차량을 등록합니다. 모델 인식 결과는 후보이므로 사용자가 확인합니다. 원본 VIN·구매 문서는 DB에 저장하지 않습니다.
2. 연식, 제조사, 모델, 주행거리와 기준일, 지역, 주간 주행거리, 고속도로 비율을 저장·수정합니다.
3. `/vehicles/{id}/care-recommendations`가 동일한 결정적 규칙으로 워셔액·타이어 점검 우선순위를 계산합니다. 카드에 근거, 불확실성, 제조사별 지침의 부재를 표시합니다. 이 값은 고장 예측이나 교체 판정이 아닙니다.
4. Open-Meteo가 지역의 이전 7일 강수량을 제공하면 워셔액 점검의 맥락으로 사용합니다. 조회 실패 시 `unavailable`로 표시하고 임의의 날씨 값을 만들지 않습니다.
5. Guide에서 엔진룸 사진을 촬영하거나 업로드합니다. Meta 모델이 높은 확신으로 워셔액 기호가 있는 캡을 찾은 경우에만 모델이 반환한 좌표로 라벨을 그립니다. 불확실하면 다시 찍거나 차량 설명서를 확인하도록 안내합니다. 제품 사진은 MATCH/CONFLICT/UNKNOWN으로 표시합니다.
6. 라이브 작업 단계는 카메라 관찰 두 묶음이 일치할 때만 자동 진행합니다. 최종 정비 기록은 음성 또는 화면에서 사용자가 완료를 확인한 뒤 저장됩니다. 이력·홈·추천은 즉시 갱신되며 새로고침 후에도 유지됩니다.
7. Assistant는 저장된 사실을 근거로 답하고, 브리핑은 현재 추천과 기록을 읽습니다. Meta 응답이 사실 ID를 제시하지 못하면 읽지 않습니다. 텍스트 질문과 브라우저 TTS가 제공됩니다.

## API

| 경로 | 기능 |
| --- | --- |
| `POST /vehicles`, `GET/PATCH /vehicles/{id}` | 차량 등록·조회·편집 |
| `POST /vehicles/recognize`, `POST /vehicles/recognize-document` | Meta 차량·문서 인식 |
| `GET /vehicles/{id}/care-recommendations` | 근거 기반 추천과 날씨 상태 |
| `GET /vehicles/{id}/maintenance-records`, `POST /maintenance-records` | 사용자 확인 정비 기록·사진 |
| `POST /vehicles/{id}/inspections/analyze` | 워셔액·타이어 사진 분석 |
| `POST /sessions`, `POST /sessions/{id}/observations`, `POST /sessions/{id}/voice` | 핸즈프리 작업 상태 머신 |
| `POST /briefings`, `POST /assistant/ask`, `POST /voice/transcribe` | 브리핑·질문·음성 전사 |

## 현재 한계

- 제조사별 정비 주기·정확한 차량 부품 위치 데이터가 없어 관련 상태를 `unavailable`로 표시합니다. 일반적 점검 제안을 제조사 지침으로 표현하지 않습니다.
- Meta 키에 결제 설정이나 모델 권한이 없으면 이미지 분석·자동 단계 판정·음성 전사를 사용할 수 없습니다. 화면은 오류를 명시하고 작업을 완료한 척 기록하지 않습니다. 수동 정비 기록은 계속 쓸 수 있습니다.
- 사진의 워셔액 잔량이나 타이어 트레드 깊이는 측정하지 않습니다. 타이어 가이드는 사진의 시각적 관찰과 사용자 계측치 입력을 지원하지만, 사진만으로 교체 필요성을 판정하지 않습니다.
- 실차 클립으로 단계 판정 정확도, 지연, 거치 위치를 검증해야 합니다. 기존 `fixtures/clips`는 합성 리플레이입니다.
