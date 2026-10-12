import { describe, expect, it } from 'vitest';
import { clampScrollTop, createLoadSequence } from '../../src/ui/library/sortState.js';

describe('재조회 busy 시퀀스 — 최신 요청 기준', () => {
  it('제자리 재조회 중 다른 재조회가 겹치면 오래된 요청 완료 후에도 busy가 잔류하지 않는다', () => {
    const seq = createLoadSequence();
    const ended = seq.begin(true);
    expect(seq.isBusy()).toBe(true);
    const reload = seq.begin(false);
    expect(seq.isBusy()).toBe(false);
    seq.settle(ended);
    expect(seq.isLatest(ended)).toBe(false);
    seq.settle(reload);
    expect(seq.isBusy()).toBe(false);
  });
  it('오래된 요청의 완료가 새 제자리 요청의 busy를 끄지 않는다', () => {
    const seq = createLoadSequence();
    const first = seq.begin(true);
    const second = seq.begin(true);
    seq.settle(first);
    expect(seq.isBusy()).toBe(true);
    seq.settle(second);
    expect(seq.isBusy()).toBe(false);
  });
  it('새 요청 시작은 오래된 요청의 해제를 기다리지 않는다', () => {
    const seq = createLoadSequence();
    const first = seq.begin(true);
    const second = seq.begin(true);
    seq.settle(second);
    expect(seq.isBusy()).toBe(false);
    seq.settle(first);
    expect(seq.isBusy()).toBe(false);
  });
});

describe('scrollTop 복원 절삭', () => {
  it('범위 안이면 그대로', () => {
    expect(clampScrollTop(700, 4000, 400)).toBe(700);
  });
  it('행이 줄어 최대값을 넘으면 최대값으로 절삭', () => {
    expect(clampScrollTop(700, 900, 400)).toBe(500);
  });
  it('내용이 클라이언트 높이보다 짧으면 0', () => {
    expect(clampScrollTop(700, 300, 400)).toBe(0);
  });
});
