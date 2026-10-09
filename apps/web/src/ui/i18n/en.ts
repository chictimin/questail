/** en 사전 (W14) — 키는 ko.ts와 1:1이어야 한다(검사 테스트). */
export const en = {
  nav: {
    connect: 'Connect',
    sync: 'Sync',
    library: 'Ratings',
    settings: 'Settings',
  },
  error: {
    AUTH_INVALID_KEY: 'Invalid key',
    AUTH_ID_MISMATCH: 'Key and Steam ID do not match',
    ACCESS_PRIVATE: 'Achievement profile is private',
    RATE_LIMITED: 'Too many requests',
    NETWORK: 'Connection failed',
    PAYLOAD_CORRUPT: 'Unreadable response',
    HELD_ZERO: 'Held: zero items',
    HELD_TIME_ZERO: 'Held: zero time items',
    HELD_DEPENDENCY: 'Waiting on earlier step',
    TAG_FAILED: 'Tags unavailable',
    TAG_EMPTY: 'No tags',
  },
} as const;
