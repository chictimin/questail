<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <img src="assets/logo-light.png" alt="QuestTail 로고 — 검은색 요크셔테리어풍 강아지 얼굴 실루엣" width="180">
  </picture>
</p>

# QuestTail (퀘스테일)

> [English](./README.md) · 한국어

> 내 컴퓨터에 Steam 라이브러리를 아카이브하고 별점을 매기는 로컬 웹앱이다.

**현재 단계: R1** — 로컬 서버(Hono + React + SQLite, 단일 프로세스)로 라이브러리 별점·숨긴 게임·Markdown 내보내기를 제공한다.

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

기동 후 브라우저에서 `http://127.0.0.1:4747`을 연다. 연동 화면이 나타나면 API 키와 프로필 주소 또는 SteamID를 입력한다.

## 수집 범위

- 수집 1회는 보유 게임·플레이타임·찜 목록·게임 정보·SteamSpy 태그를 가져온다. 업적은 설정에서 켰을 때만 가져오고, 꺼져 있으면 수집 상태에 꺼짐으로 나온다.
- 게임 정보는 표시 언어 하나로만 받아온다. 첫 수집 전 설정에서 언어를 확인한다.
- 수집 상태 화면에서 소스별 상태·다시 수집·전체 다시 수집을 본다. 헤더에 게임 정보 진행이 나온다.
- 게임 정보 요청은 2초 간격이라 게임 1,000개당 약 35분 걸린다. 보유가 많으면 몇 시간 걸릴 수 있고 Steam이 요청을 막으면(429) 더 걸린다.
- 매일 04:00(운영체제 로컬 시간대)에 스냅샷을 찍는다. 서버가 켜져 있는 동안만 돌고, 꺼져 있었으면 다음 기동 때 밀린 1회를 실행한다.

## 데이터 디렉터리

- 기본 위치는 `data/<steamid64>/`이다. 저장소 루트 `data/` 아래에 Steam 연동에 성공할 때 계정 폴더가 만들어지며, 연동 전에는 계정 폴더가 없다.
- 환경변수 `QUESTAIL_DATA_DIR`에 경로를 지정하고 앱을 다시 켜면 그 경로를 그대로 쓴다. 이 경우 계정 하위 폴더를 만들지 않는다.
- 이전 버전의 단일 폴더 `data/questail.db`는 그대로 쓰인다. 단 계정 폴더와 함께 있거나, 연동된 Steam ID가 없어도 게임 기록이 있으면 앱이 기동하지 않는다. 이때는 "레거시 data/questail.db와 계정 폴더가 함께 있다 — 한쪽을 옮기거나 QUESTAIL_DATA_DIR로 지정" 안내가 나오며, 한쪽을 옮기거나 `QUESTAIL_DATA_DIR`로 쓸 폴더를 지정한다.
- 레거시 `data/`를 쓰는 경우 백업과 `steam.key`는 `data/` 바로 아래에 있다.
- 같은 데이터 폴더는 한 프로세스만 쓴다. 데이터 폴더는 로컬 디스크에 둔다. 네트워크·동기화 폴더(예: iCloud·Dropbox·NAS)에서는 잠금이 보장되지 않는다.
- 경고: 저장소 폴더를 삭제하거나 `git clean -fdx`를 실행하면 `data/`도 함께 삭제된다.

## 백업

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

- 업적 기록은 Steam 프로필의 "게임 세부 정보"가 공개일 때만 수집된다. 비공개면 해당 게임은 건너뛴다. 계정 설정 문제이며 앱 고장이 아니다.
- 업적을 기록하지 않으면 나중에 추가될 게이머 유형(TBTI) 결과와 일부 칭호에 영향을 줄 수 있다.

## 키 취급

- API 키는 계정 데이터 폴더(`data/<steamid64>/`)의 `steam.key` 파일에만 저장된다. `QUESTAIL_DATA_DIR`를 지정했으면 그 폴더에 저장된다.
- API 키를 공유하지 않는다. 유출되면 키 페이지에서 폐기하고 새로 발급받아 앱에서 교체한다.
- Windows에서는 키 파일 권한 검사(600)가 동작하지 않는다. 권한 검사를 건너뛴다.

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
│       │   ├── ui/              # React 화면 (연동·수집·라이브러리·설정)
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
