<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <img src="assets/logo-light.png" alt="QuestTail 로고 — 검은색 요크셔테리어풍 강아지 얼굴 실루엣" width="180">
  </picture>
</p>

# QuestTail (퀘스테일)

> [English](./README.md) · 한국어

> 내 컴퓨터에 Steam 라이브러리를 아카이브하고 별점을 매기는 로컬 웹앱이다.

**현재 단계: R1.5** — R1 라이브러리 아카이브(별점·숨긴 게임·Markdown 내보내기)에 홈·리캡·TBTI(게이머 유형) 화면을 더한다.

## 사전 조건

- Node.js >= 22.13
- pnpm 10.28.2
- 게임을 1개 이상 보유한 Steam 계정과 Steam Web API 키
  - [Steam API 키 페이지](https://steamcommunity.com/dev/apikey)에서 발급한다. 도메인 이름 칸에 `localhost`를 입력하고 [Steam Web API 이용 약관](https://steamcommunity.com/dev/apiterms)에 동의한 뒤 등록한다.
  - 발급이 막히면("제한된 사용자 계정" 안내) 아직 키를 받을 수 없는 계정이다. [Steam 지원 페이지](https://help.steampowered.com/en/faqs/view/71D3-35C2-AD96-AA3A)를 확인한다.

## 빠른 시작

<!-- ci:run -->
```bash
git clone https://github.com/chictimin/questail.git
cd questail
pnpm install && pnpm start
```

기동 후 브라우저에서 `http://127.0.0.1:4747`을 연다. 루트 주소 `/`는 Steam 계정이 이미 연동돼 있으면 홈으로, 아니면 연동 화면으로 이동한다. 연동 화면에서 API 키와 프로필 주소 또는 SteamID를 입력한다.

## 수집 범위

- 수집 1회는 보유 게임·플레이타임·찜 목록·게임 정보·SteamSpy 태그를 가져온다. 업적은 켰을 때만 가져온다(기본 꺼짐, 꺼져 있으면 수집 상태에 꺼짐으로 나온다). 첫 수집 전에 연동 화면의 체크박스로 정하며, 나중에 설정에서 바꿀 수 있다.
- 게임 정보는 표시 언어 하나로만 받아온다. 첫 수집 전 설정에서 언어를 확인한다. 한국어를 고르면 한국어 출시일 텍스트(`YYYY년 M월 D일`)와 장르명을 해석하며, 업데이트 시 마이그레이션이 기존 게임의 출시일을 그 텍스트에서 자동으로 채운다(자동 백업 후).
- 수집 상태 화면에서 소스별 상태·다시 수집·전체 다시 수집을 본다. 헤더에 게임 정보 진행이 나온다.
- 게임 정보 요청은 2초 간격이라 게임 1,000개당 약 33분 걸린다. 보유가 많으면 몇 시간 걸릴 수 있고 Steam이 요청을 막으면(429) 더 걸린다.
- 매일 04:00(운영체제 로컬 시간대)에 스냅샷을 찍는다. 서버가 켜져 있는 동안만 돌고, 꺼져 있었으면 다음 기동 때 밀린 1회를 실행한다.

## R1.5: 홈·리캡·TBTI

- 홈은 누적 플레이타임(보유 중 플레이), 상위 5개 게임, 가장 많은 장르, 별점 평균, TBTI 카드(자세히 보기 연결)를 보여준다.
- 리캡은 전체 라이브러리를 요약한다. 관측일 띠(첫 수집이 기준선), 상위 5개 비중, 장르 막대, 별점 평균·분포와 유독 높고 낮은 게임, 플레이타임 구간, 출시 시기(신작·최근·고전), 안 켠 게임과 빠진 게임, 맨 위 TBTI 카드로 구성된다.
- 모든 시간은 Steam 서버 기록 기준이다. 화면은 맹점을 숨기지 않고 밝힌다. 관측일, 숨김 제외, Steam 밖 기록 없음, 미확인 장르·출시일, 미반영 업적이다.
- TBTI는 내 기록 분포에서 4축을 판정한다. 축마다 한 줄이다.
  - 1축 플레이 결 — 몰입(I) vs 런(R), 유저 태그 기준.
  - 2축 취향 출처 — 신작(N) vs 본진(H), 출시 대비 플레이 시점 기준.
  - 3축 장르 폭 — 원툴(O) vs 잡식(A), 장르 분포 기준.
  - 4축 깊이 — 파먹기(C) vs 찍먹(L), 플레이 시간과 업적 기준.
- 축마다 근거를 보여준다. 기여 상위 게임(이유·수치)과 공개 기준선(있는 경우)이다. 합계 5시간 미만이면 TBTI는 미정(`????`)으로 두고 진행 막대를 보여주며, 미정 축은 `?`와 한 줄 사유(기록 부족, 또는 경계 걸침)를 보여준다.
- 찜 반영 토글(설정, 기본 켜짐): 출시 전 찜 기록을 2축 신작 증거로 쓴다. 끄면 그 증거를 빼고 화면에 표시한다.
- 시리즈 별칭은 데이터 폴더 직하의 `series-aliases.json`에 둔다. 키는 정규화한 게임명이다. 소문자, 에디션 꼬리(`Remastered`·`Definitive Edition` 등) 제거, 로마숫자 I~X는 아라비아 숫자로(예: `Dark Souls III` → `dark souls 3`) 쓴다. 정규화명 전체가 먼저 맞으면 그 시리즈로 묶고, 아니면 첫 구분자(`:`·` - ` 등) 앞부분으로 묶는다.

  ```
  { "aliases": { "monster hunter": "monster-hunter" } }
  ```

  파일이 없으면 내장 기본값을 쓰고, 깨진 파일(JSON 오류·형태 불일치)이면 별칭 없이 동작한다.
- 리캡과 TBTI는 텍스트로 가져간다. 화면의 복사 버튼, TBTI 공유 시트(리캡 함께 내보내기 선택, 계정 정보 미포함), `recap.md` Markdown 내보내기다.

## 데이터 디렉터리

- 기본 위치는 `data/<steamid64>/`이다. 저장소 루트 `data/` 아래에 Steam 연동에 성공할 때 계정 폴더가 만들어지며, 연동 전에는 계정 폴더가 없다.
- 환경변수 `QUESTAIL_DATA_DIR`에 경로를 지정하고 앱을 다시 켜면 그 경로를 그대로 쓴다. 이 경우 계정 하위 폴더를 만들지 않는다.
- 이전 버전의 단일 폴더 `data/questail.db`는 그대로 쓰인다. 연동된 Steam ID도 게임 기록도 없는 빈 레거시 DB는 경고만 남기고 무시한다. 단 두 경우에는 앱이 기동하지 않는다. 계정 폴더와 함께 있으면 "legacy data/questail.db and an account folder exist together — move one of them or set QUESTAIL_DATA_DIR" 안내가 나오며, 한쪽을 옮기거나 `QUESTAIL_DATA_DIR`로 쓸 폴더를 지정한다. 연동된 Steam ID가 없어도 게임 기록이 있으면 "legacy data/questail.db has game records that are not linked, so the app does not start — point QUESTAIL_DATA_DIR at that folder or move it manually" 안내가 나온다.
- 레거시 `data/questail.db`를 열 수 없을 때도 앱이 기동하지 않는다. "cannot read legacy data/questail.db; cannot start — check or move the file" 안내가 나온다.
- `data/`에 계정 폴더가 둘 이상 있으면 앱이 기동하지 않는다. "more than one account folder — set QUESTAIL_DATA_DIR" 안내가 나오며, `QUESTAIL_DATA_DIR`로 쓸 폴더 하나를 지정한다.
- 계정 폴더 안 DB의 계정 ID가 폴더 이름과 다르거나 읽을 수 없으면 앱이 기동하지 않는다. "account ID in the account folder DB differs from the folder name — fix or move that folder" 안내가 나오며, 해당 폴더를 고치거나 옮긴다.
- 레거시 `data/`를 쓰는 경우 백업과 `steam.key`는 `data/` 바로 아래에 있다.
- 같은 데이터 폴더는 한 프로세스만 쓴다. 데이터 폴더는 로컬 디스크에 둔다. 네트워크·동기화 폴더(예: iCloud·Dropbox·NAS)에서는 잠금이 보장되지 않는다.
- 경고: 저장소 폴더를 삭제하거나 `git clean -fdx`를 실행하면 `data/`도 함께 삭제된다.

## 백업

- 자동 백업: 기존 DB에 보류 중인 스키마 마이그레이션을 적용하기 전, 그리고 기존 계정 폴더에 연동할 때 데이터 폴더 바로 아래 `backups/`에 `questail-<UTC 시각>.db`를 만든다. 개수 제한은 없다. 새 빈 DB에는 백업을 만들지 않는다. 레거시 `data/`를 쓰면 `data/backups/`이다.
- 수동 백업: 앱을 끈 뒤 데이터 폴더(`data/<steamid64>/`)를 통째로 복사한다(SQLite 파일).

## 포트

- 기본 포트는 `4747`이다. 환경변수 `QUESTAIL_PORT`로 변경한다. 사용 중인 포트면 기동에 실패하고 안내가 나온다.

## 종료

- Ctrl+C로 종료한다.
- 백그라운드·서비스 실행은 `pnpm start`로 한 번 빌드한 뒤 서버를 직접 실행한다:

```bash
node apps/web/dist/src/server/run.js
```

`pnpm`은 SIGTERM을 자식 프로세스에 전달하지 않으므로 `pnpm` 경유 종료는 서버를 남길 수 있다.

## 업적

- 수집은 선택이다. 연동 화면의 체크박스(기본 꺼짐)로 첫 수집 전에 정하고, 설정에서 나중에 바꿀 수 있다.
- 업적 기록은 Steam 프로필의 "게임 세부 정보"가 공개일 때만 수집된다. 비공개면 해당 게임은 건너뛴다. 계정 설정 문제이며 앱 고장이 아니다.
- 업적을 기록하지 않으면 TBTI 깊이 축은 플레이 시간만으로 판정하며, 화면에 업적 미반영 안내와 바로잡기 동작을 보여준다.

## 키 취급

- API 키는 계정 데이터 폴더(`data/<steamid64>/`)의 `steam.key` 파일에만 저장된다. `QUESTAIL_DATA_DIR`를 지정했으면 그 폴더에 저장된다.
- API 키를 공유하지 않는다. 유출되면 키 페이지에서 폐기하고 새로 발급받아 앱에서 교체한다.
- Windows에서는 키 파일 권한 검사(600)가 동작하지 않는다. 권한 검사를 건너뛴다.

## 테스트

- `pnpm test`는 단위·브라우저 E2E 테스트를 실행한다. 실제 Steam 계정과 API 키는 필요 없다. E2E 브라우저를 먼저 설치한다(CI와 같은 명령):

```bash
pnpm --filter @questail/web exec playwright install --with-deps chromium
```

## 참고

- 이 앱은 Valve와 무관하다. Steam은 Valve Corporation의 상표다.

## 보관된 v0.3 기능

- `packages/core`의 CLI(`sniff`·`gather`·`analyze`·`config`)와 에이전트 계층은 R1에서 보관됐다. R1 실행 경로는 `pnpm start`다.

## 구조

```
questail/
├── apps/
│   └── web/                     # R1 앱 (Hono 서버 + React UI + SQLite)
│       ├── src/
│       │   ├── server/          # HTTP 라우트·기동 순서
│       │   ├── ui/              # React 화면 (연동·홈·리캡·TBTI·수집·라이브러리·내보내기·설정)
│       │   ├── data/            # 라이브러리·별점·화면 상태 서비스
│       │   └── db/              # 스키마·마이그레이션·열기/백업/이행
│       └── test/                # 단위·E2E·성능 하네스
├── packages/
│   └── core/                    # 공유 계약·평가 도구
├── pnpm-workspace.yaml
└── package.json
```

## 라이선스

MIT

서드파티 고지는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 본다.
