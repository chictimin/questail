# QuestTail (퀘스테일)

> [English](./README.md) · 한국어

> 여러 플랫폼(Steam/PSN/Xbox)에 흩어진 게임 이력을 모아 Markdown으로 아카이빙하고, LLM으로 개인 취향 분석을 받는 personal-first 도구.

**현재 단계: M1** — Steam 라이브러리를 Markdown 파일로 추출하는 CLI.

## 설치

```bash
git clone https://github.com/chictimin/questail.git
cd questail
pnpm install
pnpm build

# 전역 실행 (선택)
pnpm link --global
```

## 사용법

```bash
# 1. API 키 + SteamID 등록 (최초 1회)
questail sniff

# 2. Steam 라이브러리 수집
questail gather steam

# 3. 설정 관리
questail config set language en
questail config get steam-api-key
```

### 자세한 흐름

**`questail sniff`** — 대화형 설정입니다. Steam Web API 키와 SteamID를 한 번에 등록합니다.

- SteamID는 프로필 URL(`https://steamcommunity.com/id/xxx`), vanity name, 또는 숫자 SteamID64 모두 지원 (자동 변환)
- `~/.config/questail/.env`에 저장되어 다음부터는 생략 가능
- Steam 등록 뒤에 LLM 설정 단계가 이어집니다: `1. OpenAI / 2. 로컬 호환(Ollama·LM Studio) / 3. 건너뛰기`. 선택 결과는 같은 파일에 `QUESTAIL_LLM_BASE_URL` / `QUESTAIL_LLM_API_KEY` / `QUESTAIL_LLM_MODEL`로 저장됩니다 (전역 설정 파일을 다른 도구와 공유하므로 충돌 방지를 위해 questail 전용 네임스페이스 사용). 건너뛰면 AI 해석 없는 정량 리포트로 동작합니다.
- 등록 후 바로 `gather steam`을 실행할지 묻습니다

**`questail gather steam [<id>] [-o <dir>]`** — Steam 라이브러리를 가져오고 보강합니다.

- `<id>` 생략 시 config에 저장된 steam-id 사용
- `-o <dir>` 출력 디렉토리 (기본: `./games/`)
- Steam appdetails로 게임 메타(장르·개발사·퍼블리셔·출시일·커버 이미지)를 자동 보강합니다
- 게임별 업적 달성률을 조회합니다 — Steam 프로필의 "게임 세부정보"가 공개 상태여야 동작하며, 비공개면 조용히 스킵됩니다
- 출력 디렉토리에 `library.md`(객관 데이터 정본 인덱스)를 생성하고 `history.jsonl`(플레이타임 스냅샷 로그)에 누적합니다
- 재실행은 비파괴 방식입니다: `games/*.md`의 객관 필드는 최신화되고, 주관 필드(별점·한줄평 등, 추가되는 대로)는 보존됩니다

**`questail config`** — 설정 관리:

| 명령어 | 설명 |
|--------|------|
| `questail config set <key> <value>` | 키-값 저장 |
| `questail config get <key>` | 값 조회 (민감 정보 마스킹) |
| `questail config delete <key>` | 값 삭제 |

### 설정 키

| 키 | 설명 | 예시 |
|---|------|------|
| `steam-api-key` | Steam Web API 키 | `ABCDEF1234567890` |
| `steam-id` | SteamID64 (숫자) | `76561197960287930` |
| `language` | 출력 언어 (`ko` / `en`) | `en` |
| `QUESTAIL_LLM_BASE_URL` | LLM 엔드포인트 (`sniff`로 설정) | `https://api.openai.com/v1` |
| `QUESTAIL_LLM_API_KEY` | LLM API 키 (로컬호스트는 생략 가능) | `sk-...` |
| `QUESTAIL_LLM_MODEL` | LLM 모델명 (`sniff`로 설정) | `gpt-4o-mini` |

## 출력 예시

`./games/` 디렉토리에 게임별 md 파일이 생성됩니다:

```markdown
---
title: ELDEN RING
game_id: 1245620
platform: steam
source: auto
playtime_minutes: 9840
achievement_pct: 62
last_played: 1712345678
image: https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg
genres: [RPG, Souls-like]
developers: [FromSoftware Inc.]
publishers: [FromSoftware Inc., Bandai Namco Entertainment]
release_date: 24 Feb, 2022
---

> Steam에서 자동 가져온 게임 데이터입니다.
```

파일명: `{appId}-{title-slug}.md` (예: `1245620-elden-ring.md`)

보강 필드(`achievement_pct`, `genres`, `developers`, `publishers`, `release_date`, `image`)는 데이터가 있을 때만 기록됩니다. `gather`를 다시 실행하면 객관 필드가 최신화되고, 주관 필드(`rating`, `note`)는 추가된 이후부터 보존됩니다.

## 구조

```
questail/
├── packages/
│   └── core/                  # @questail/core
│       ├── src/
│       │   ├── config/        # 전역 LLM 설정 (QUESTAIL_LLM_*)
│       │   ├── llm/           # LLM 어댑터 (단일 엔드포인트 + 무LLM 폴백)
│       │   ├── connectors/    # 플랫폼 어댑터 (Steam)
│       │   ├── metadata/      # appdetails 보강 (캐시)
│       │   ├── normalize/     # 표준 스키마 변환
│       │   ├── storage/       # Markdown 직렬화
│       │   ├── i18n.ts        # 다국어 지원
│       │   └── cli.ts         # CLI 진입점
│       └── package.json
├── pnpm-workspace.yaml
└── package.json
```

## 앞으로

| 단계 | 목표 |
|------|------|
| **M1** ✅ | Steam 라이브러리 → Markdown CLI |
| M2 | AI 취향 분석 리포트 CLI |
| M3 | 별점 입력 + 웹 데모 UI |
| M4+ | PSN/Xbox, 수기 추가, 분석 심화 |

## 라이선스

MIT
