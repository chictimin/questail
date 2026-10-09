import { defineConfig } from 'drizzle-kit';

/** D-01 drizzle 설정. SQLite 전용, 마이그레이션 출력은 apps/web/drizzle. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
