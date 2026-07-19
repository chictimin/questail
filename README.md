# QuestTail (퀘스테일)

> 여러 플랫폼(Steam/PSN/Xbox)에 흩어진 게임 이력을 모아 Markdown으로 아카이빙하고, LLM으로 개인 취향 분석을 받는 personal-first 도구.

**현재 단계: M1** — Steam 라이브러리를 Markdown 파일로 추출하는 CLI.

## 설치

```bash
git clone https://github.com/chictimin/questail.git
cd questail
pnpm install
pnpm build
```

## 사용법

```bash
# 1. Steam Web API 키 발급 (https://steamcommunity.com/dev/apikey)
export STEAM_API_KEY=ABCDEF1234567890

# 2. Steam 라이브러리 → Markdown 파일로 추출
node packages/core/dist/cli.js import steam <SteamID64>

# 출력 디렉토리 지정 (기본: ./games/)
node packages/core/dist/cli.js import steam <SteamID64> --output ./my-vault/games
```

### SteamID64 확인 방법

Steam 프로필 URL에서 확인:
- `https://steamcommunity.com/profiles/76561197960287930` → `76561197960287930`
- 커스텀 URL(`https://steamcommunity.com/id/myname`)인 경우 [SteamID Finder](https://steamidfinder.com/) 등으로 변환

## 출력 예시

`./games/` 디렉토리에 게임별 md 파일이 생성됩니다:

```markdown
---
title: ELDEN RING
game_id: 1245620
platform: steam
source: auto
playtime_minutes: 9840
achievement_pct: 67
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
│       │   ├── connectors/    # 플랫폼 어댑터 (Steam 등)
│       │   ├── normalize/     # 표준 스키마 변환
│       │   ├── storage/       # Markdown 직렬화
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
