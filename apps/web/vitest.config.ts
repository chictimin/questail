import { expect, test } from 'vitest';

/** 단위 테스트만 실행한다. 브라우저 E2E는 playwright가 맡는다. */
export default {
  test: {
    include: ['test/unit/**/*.unit.test.ts'],
  },
};
