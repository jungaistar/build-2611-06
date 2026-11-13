# build-2611-06 · VPD math & load 데이터 관리 (v2.0) · VPD 운영 업무 보조 (v1.0)

생성형 AI 업무자동화 전문가과정 **2차수** 수강생 프로젝트 06 — 기획 이정우.

**바로 쓰기: https://aebonlee.github.io/build-2611-06/** (v2.0 데이터 관리) · **진행 현황(v1.0): https://aebonlee.github.io/build-2611-06/progress.html**

## v2.0 (2026-11-04) — math & load 데이터 관리

검증 진행에 쓰는 math & load 데이터 가운데 여러 팀이 함께 쓰는 값을 한 곳에서 관리합니다.
양식 엑셀을 올리면 기종 프로젝트마다 팀별 입력 항목이 만들어지고, 누가 무엇을 아직 안 넣었는지 보이며,
팀별 입력 파일을 나눠 주고 되돌려 받아 병합합니다. 자동 계산 칸은 양식의 수식을 그대로 따릅니다.
파일은 브라우저 안에서만 처리하며 서버로 올라가지 않습니다. **기획자 양식 원본은 저장소에 없고, 예제 양식은 가상입니다.**

| 파일 | 역할 |
|---|---|
| `js/vpdm.js` | (v2.0) 엔진 — 양식 읽기(머리글 역할·값 칸·수식·입력 주체·여러 표)·프로젝트·값 넣기·자동 계산·현황·미입력 글·팀 배포·병합·취합본·예제 |
| `index.html` · `js/app2.js` | (v2.0) 데이터 관리 화면 |
| `js/vpd.js` · `progress.html` · `js/app.js` | (v1.0) 검증항목 진행 현황 · EIM 요약 · 요청 메일 초안 — 그대로 |
| `test/logic.test.js` | 규칙 테스트 `node test/logic.test.js` — 142 (v1.0 71 + v2.0 71) |
| `test/smoke.browser.js` | 화면 연기 테스트(playwright) — 50 (v1.0 23 + v2.0 27) |
| `CLAUDE.md` | 작업 지시서 + 기획서 원문 |

```sh
node test/logic.test.js
node test/smoke.browser.js              # playwright 필요
```

## 기획서 · 버전

- 사이트 「기획서」 페이지: https://aebonlee.github.io/build-2611-06/plan.html — 워드 판 내려받기
- 워드 판: `docs/기획서/build-2611-06_이정우_<제목>_기획서_v<버전>.docx` (버전마다 남김 — v1.0 은 「VPD운영업무보조」)
- 원본: `docs/plan.json` → 생성기 `build-2611-00/tools/plandoc/make_plan.py`
