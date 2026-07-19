# QuestTail (퀘스테일)

> 여러 플랫폼(Steam/PSN/Xbox)에 흩어진 게임 이력을 모아 Markdown으로 아카이빙하고, LLM으로 개인 취향 분석을 받는 personal-first 도구.

## M1 — Steam 라이브러리를 md로 추출하는 CLI

### 사전 준비

1. [Steam Web API 키](https://steamcommunity.com/dev/apikey) 발급
2. 환경변수 설정:
   ```bash
   export STEAM_API_KEY=<your_api_key>
   ```

### 사용법

```bash
# SteamID로 게임 목록 가져오기 (md 출력)
questail import steam <steamId>
```

### 예시

```bash
export STEAM_API_KEY=ABCDEF1234567890
questail import steam 76561197960287930
```

## 구조

```
questail/
├── packages/
│   └── core/          # 헤드리스 코어 패키지
│       ├── connectors/  # 플랫폼 어댑터 (Steam 등)
│       ├── normalize/   # 표준 스키마 변환
│       └── storage/     # Markdown 직렬화
├── pnpm-workspace.yaml
└── package.json
```

## 라이선스

MIT
