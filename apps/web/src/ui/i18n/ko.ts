/** ko 사전 (W14) — 키는 en.ts와 1:1이어야 한다(검사 테스트). */
export const ko = {
  nav: {
    connect: '연동',
    sync: '수집',
    library: '별점 리스트',
    settings: '설정',
  },
  error: {
    AUTH_INVALID_KEY: '키가 올바르지 않다',
    AUTH_ID_MISMATCH: '키와 Steam ID가 맞지 않는다',
    ACCESS_PRIVATE: '업적 프로필이 비공개다',
    RATE_LIMITED: '요청이 잦다',
    NETWORK: '연결에 실패했다',
    PAYLOAD_CORRUPT: '응답을 읽을 수 없다',
    HELD_ZERO: '응답 0건이라 보류했다',
    HELD_TIME_ZERO: '시간 응답 0건이라 보류했다',
    HELD_DEPENDENCY: '앞 단계 대기 중이다',
    TAG_FAILED: '태그를 못 가져왔다',
    TAG_EMPTY: '태그가 없다',
    KEY_STORE_FAILED: '키를 저장하지 못했다 — 데이터 폴더 권한과 저장 공간 확인 후 다시 시도',
  },
} as const;
