-- 합성 v1 DB 스키마. 구 버전 DB를 흉내낸 시험용 2테이블이다. 실제 데이터 0건.
-- legacy_ratings는 계약 ratings 형(게임 복합키·score 1..10)을 따른 합성 원천이다.
CREATE TABLE legacy_kv (
	key TEXT PRIMARY KEY,
	value TEXT
);
--> statement-breakpoint
CREATE TABLE legacy_ratings (
	platform TEXT NOT NULL,
	external_id TEXT NOT NULL,
	score INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	updated_by TEXT NOT NULL,
	PRIMARY KEY(platform, external_id)
);
