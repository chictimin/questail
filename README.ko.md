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
- 등록 후 바로 `gather steam`을 실행할지 묻습니다

**`questail gather steam [<id>] [-o <dir>]`** — Steam 라이브러리를 가져옵니다.

- `<id>` 생략 시 config에 저장된 steam-id 사용
- `-o <dir>` 출력 디렉토리 (기본: `./games/`)

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

## 출력 예시

`./games/` 디렉토리에 게임별 md 파일이 생성됩니다:

```markdown
---
title: ELDEN RING
game_id: 1245620
platform: steam
source: auto
playtime_minutes: 9840
last_played: 1712345678
---

> Steam에서 자동 가져온 게임 데이터입니다.
```

파일명: `{appId}-{title-slug}.md` (예: `1245620-elden-ring.md`)

## 구조

```
questail/
├── packages/
│   └── core/                  # @questail/core
│       ├── src/
│       │   ├── connectors/    # 플랫폼 어댑터 (Steam)
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
