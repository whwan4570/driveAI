# 실제 영상 테스트 세트

워셔액 가이드가 실제 영상에서 잘못 넘어가거나 잘못 기록하지 않는지 확인한다. 정답은 사람이 정하고 `backend/carmori/clip_cases.py`에 있다. 모델 답변을 저장한 뒤에는 규칙을 고쳐도 API를 다시 부르지 않고 반복 검증할 수 있다.

## 안전

- 시동을 끄고 엔진이 식은 뒤 찍는다.
- **냉각수, 오일 병은 라벨만 보여준다. 워셔 탱크에 넣지 않는다.** 붓는 동작이 필요하면 빈 병을 쓴다.
- 정상 주입 영상은 탱크가 넘치지 않을 만큼만 붓는다.

## 촬영 준비

- 폰을 거치대에 고정하고 모든 영상에서 같은 각도를 유지한다.
- 주입구와 손, 병이 함께 보이게 한다. 라벨은 카메라 가까이 든다.
- 낮이나 고른 조명에서 후면 카메라로 찍는다. 화면을 찍지 말고 실제 차를 찍는다.
- 모든 영상은 안내 첫 단계부터 재생되므로, 시작할 때 닫힌 캡을 3초 보여준다.
- 영상 끝까지 마지막 상태를 3초 이상 유지한다.

## 촬영 목록

14개, 약 405초다. 파일 이름은 `촬영ID_번호`로 한다(예: `normal_01.mp4`).

| 촬영 ID | 횟수 | 길이 | 확인할 점 | 찍는 방법 | 끝나야 할 상태 |
|---|---|---|---|---|---|
| `normal` | 3 | 40초 | A real refill is recorded from what the camera saw | Show the closed cap, open it, show the washer fluid label, then pour with the flow visible, stand the bottle up, and close the cap. | `RECORDED · observed_sequence` |
| `closed_cap_only` | 1 | 10초 | A closed cap alone does not advance past opening | Show the closed cap and touch nothing until the end. | `OPEN_CAP` |
| `hand_only` | 1 | 15초 | A hand near the cap is not an opened cap | Show the closed cap, then rest a hand on or beside it. Do not open it. | `OPEN_CAP` |
| `cap_blocked` | 1 | 15초 | A hidden cap never counts as opened | Show the closed cap, then keep a hand over it until the end. Do not open it. | `OPEN_CAP · OCCLUDED` |
| `cap_blocked_then_open` | 1 | 25초 | The guide recovers after the view clears | Show the closed cap, cover it for 5 seconds, then uncover and open it. Keep it in view. | `CONFIRM_PRODUCT` |
| `coffee_cup` | 1 | 25초 | A non-automotive item is not accepted as a product | Show the closed cap, open it, then hold up a coffee cup until the end. | `CONFIRM_PRODUCT · PRODUCT_CONFLICT` |
| `coolant_bottle` | 1 | 25초 | A different automotive fluid is refused | Show the closed cap, open it, then hold up a coolant or oil label until the end. | `CONFIRM_PRODUCT · PRODUCT_CONFLICT` |
| `label_hidden` | 1 | 25초 | An unreadable label waits instead of passing | Show the closed cap, open it, then hold the washer bottle with its label turned away until the end. | `CONFIRM_PRODUCT · PRODUCT_UNKNOWN` |
| `bottle_swap` | 1 | 30초 | Changing bottles during the pour goes back to the label check | Show the closed cap, open it, show the washer fluid label, then tilt an EMPTY coolant or oil bottle over the inlet with its label visible. Pour nothing. | `CONFIRM_PRODUCT · PRODUCT_CONFLICT` |
| `empty_bottle_pour` | 1 | 40초 | A pretend pour is not recorded as observed | Show the closed cap, open it, show the washer fluid label, then tilt an empty bottle with no flow, stand it up, and close the cap. | `FINISH · NEED_VOICE_CONFIRM` |
| `pour_flow_hidden` | 1 | 40초 | A pour out of view asks the driver instead of recording | Show the closed cap, open it, show the washer fluid label, then pour with your hand or the bottle blocking the flow, stand it up, and close the cap. | `FINISH · NEED_VOICE_CONFIRM` |
| `cap_left_open` | 1 | 35초 | A refill is not finished while the cap is open | Show the closed cap, open it, show the washer fluid label, then pour with the flow visible, stand the bottle up, and leave the cap open. | `FINISH` |

## 처리

원본은 `recordings/`, 프레임은 `fixtures/frames/`에 둔다. 둘 다 git에 올라가지 않는다. 명령은 저장소 루트와 `backend/`에서 각각 실행한다.

```bash
mkdir -p fixtures/frames/coffee_cup_01 && ffmpeg -i recordings/coffee_cup_01.mp4 -vf fps=2 fixtures/frames/coffee_cup_01/%05d.jpg
```

```bash
.venv/bin/python -m carmori.annotate ../fixtures/frames/coffee_cup_01 --case coffee_cup --take 1 --max-side 1280 --out ../fixtures/clips/recorded/coffee_cup_01.json
```

```bash
.venv/bin/carmori-replay ../fixtures/clips/recorded --report ../fixtures/clips/recorded/REPORT.md -v
```

`annotate`는 저장소 루트의 `.env`에서 키를 읽는다. `--roi`는 쓰지 않는다. 앱은 라벨 단계에서 전체 화면을 보내므로, 고정 크롭을 쓰면 병이 잘린다.

## 비용

기본 설정에서는 영상 1초당 모델을 약 1번 호출한다(2fps, 호출당 2장). 전체를 한 번 처리하면 **약 405번**이다. 추론 수준을 비교하면 그 배수로 늘어난다. `normal_01` 하나로 먼저 확인한 뒤 나머지를 처리한다.

## 결과 읽기

`REPORT.md`는 실패를 먼저 보여준다.

| 결과 | 뜻 | 중요도 |
|---|---|---|
| Advanced too far | 끝나야 할 단계보다 더 진행함 | **안전 문제, 먼저 고친다** |
| Wrong record saved | 저장하면 안 되는 기록을 저장했거나 종류가 틀림 | **안전 문제, 먼저 고친다** |
| Stopped early | 앞 단계에서 멈춤 | 인식률 문제 |
| Wrong wait reason | 단계는 맞지만 안내가 틀림 | 안내 문제 |
| Record not saved | 끝났는데 기록이 없음 | 인식률 문제 |

실패가 나오면 `-v`로 전환 시점을 보고 영상과 비교한다. 정답을 결과에 맞춰 고치지 않는다.

## 한계

- `annotate`는 모든 항목을 한 번에 묻고 참고 프레임 없이 보낸다. 앱은 단계별 항목만 묻고 직전 단계 프레임을 함께 보낸다.
- 긴 변 1280px을 쓰지만 앱은 주입구 단계에서 768px 크롭을 보낸다. 라벨 단계에 맞춘 설정이다.
- 이 차이 때문에 통과해도 폰에서 전체 흐름을 한 번 더 확인해야 한다.
