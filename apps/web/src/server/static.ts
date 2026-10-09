/**
 * W14 정적 UI 서빙 — 단일 프로세스에서 Hono가 빌드 산출(dist-ui)을 서빙한다.
 * 순서: hostCheck → /api/* → 정적 → SPA fallback(/api/* 제외, /api 미매칭은 404 유지).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { findRepoRoot } from './boot.js';

export const UI_DIST_NAME = 'dist-ui';
export const INDEX_FILE = 'index.html';

/** 빌드 산출 디렉터리 — 저장소 루트 기준(src·dist 레이아웃 무관). */
export function uiDistDir(fromDir?: string): string {
  return join(findRepoRoot(fromDir), 'apps', 'web', UI_DIST_NAME);
}

/** 정적 서빙 + SPA fallback을 장착한다. 실재 파일이면 서빙, 아니면 fallback이다. */
export function wireStatic(app: Hono, staticRoot: string): void {
  app.use('/*', serveStatic({ root: staticRoot }));
  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ status: 'not_found' }, 404);
    }
    return c.html(await readFile(join(staticRoot, INDEX_FILE), 'utf-8'));
  });
}
