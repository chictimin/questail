CREATE TABLE `account` (
	`id` integer PRIMARY KEY NOT NULL,
	`steam_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "account_single_row" CHECK(id = 1)
);
--> statement-breakpoint
CREATE TABLE `achievement_states` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`state` text NOT NULL,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "achievement_states_values" CHECK(state IN ('ready', 'empty', 'failed', 'not_collected'))
);
--> statement-breakpoint
CREATE TABLE `achievements` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`apiname` text NOT NULL,
	`achieved` integer NOT NULL,
	`unlocked_at` integer,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`, `apiname`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "achievements_achieved_values" CHECK(achieved IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`generation` integer NOT NULL,
	`source` text NOT NULL,
	`item_key` text NOT NULL,
	`done_at` integer NOT NULL,
	`sync_run_id` integer,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoints_generation_source_item_key_unique` ON `checkpoints` (`generation`,`source`,`item_key`);--> statement-breakpoint
CREATE TABLE `game_genres` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`genre_id` text NOT NULL,
	`genre_name_en` text NOT NULL,
	`genre_name_ko` text,
	`position` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`, `genre_id`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `game_user_tags` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`tag` text NOT NULL,
	`votes` integer NOT NULL,
	`rank` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`, `tag`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `games` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`title_ko` text,
	`developer_raw` text,
	`release_date_text` text,
	`release_date` integer,
	`cover_url` text,
	PRIMARY KEY(`platform`, `external_id`)
);
--> statement-breakpoint
CREATE TABLE `hidden_games` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`hidden_at` integer NOT NULL,
	PRIMARY KEY(`platform`, `external_id`),
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `import_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`source_ref` text,
	`kept_count` integer NOT NULL,
	`dropped_count` integer NOT NULL,
	`first_run_at` integer NOT NULL,
	`last_run_at` integer NOT NULL,
	`rerun_blocked` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_ledger_kind_unique` ON `import_ledger` (`kind`);--> statement-breakpoint
CREATE TABLE `meta_states` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`state` text NOT NULL,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "meta_states_values" CHECK(state IN ('ready', 'empty', 'failed', 'not_collected'))
);
--> statement-breakpoint
CREATE TABLE `ownership_spans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`origin` text NOT NULL,
	`started_at` integer,
	`ended` integer NOT NULL,
	`ended_at` integer,
	`is_baseline` integer NOT NULL,
	`sync_run_id` integer,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ownership_origin_values" CHECK(origin IN ('observed', 'baseline', 'imported')),
	CONSTRAINT "ownership_ended_values" CHECK(ended IN (0, 1)),
	CONSTRAINT "ownership_baseline_values" CHECK(is_baseline IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ownership_open_one` ON `ownership_spans` (`platform`,`external_id`) WHERE ended = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `ownership_null_start_one` ON `ownership_spans` (`platform`,`external_id`) WHERE started_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX `ownership_spans_platform_external_id_started_at_unique` ON `ownership_spans` (`platform`,`external_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `playtime_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`observed_day` text NOT NULL,
	`timezone` text NOT NULL,
	`total_minutes` integer NOT NULL,
	`last_played` integer,
	`playtime_2weeks` integer,
	`is_review` integer NOT NULL,
	`review_reason` text,
	`sync_run_id` integer,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "snapshots_review_values" CHECK(is_review IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playtime_snapshots_platform_external_id_observed_day_unique` ON `playtime_snapshots` (`platform`,`external_id`,`observed_day`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rating_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`before_score` integer,
	`after_score` integer,
	`created_at` integer NOT NULL,
	`sync_run_id` integer,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rating_events_before_range" CHECK(before_score IS NULL OR before_score BETWEEN 1 AND 10),
	CONSTRAINT "rating_events_after_range" CHECK(after_score IS NULL OR after_score BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE INDEX `rating_events_game_created` ON `rating_events` (`platform`,`external_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ratings` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`score` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`platform`, `external_id`),
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ratings_score_range" CHECK(score BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE `review_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`kind` text NOT NULL,
	`delta_minutes` integer NOT NULL,
	`elapsed_seconds` integer NOT NULL,
	`prev_observed_at` integer,
	`sync_run_id` integer,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_kind_values" CHECK(kind IN ('negative_clamped', 'spike'))
);
--> statement-breakpoint
CREATE TABLE `sync_generations` (
	`source` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`item_count` integer,
	`observed_day` text NOT NULL,
	`is_finalized` integer NOT NULL,
	`issue_code` text,
	`issue_params` text,
	CONSTRAINT "sync_runs_source_values" CHECK(source IN ('owned', 'wishlist', 'meta', 'achievements', 'steamspy')),
	CONSTRAINT "sync_runs_status_values" CHECK(status IN ('idle', 'running', 'ok', 'failed', 'held'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_runs_source_started_at_unique` ON `sync_runs` (`source`,`started_at`);--> statement-breakpoint
CREATE TABLE `tag_sources` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`tag_status` text NOT NULL,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tag_sources_values" CHECK(tag_status IN ('ready', 'empty', 'failed', 'not_collected'))
);
--> statement-breakpoint
CREATE TABLE `view_sort_state` (
	`filter_key` text PRIMARY KEY NOT NULL,
	`sort_key` text NOT NULL,
	`direction` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wishlist_spans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`date_added` integer,
	`first_observed_at` integer NOT NULL,
	`priority` integer,
	`observed_at` integer,
	`ended` integer NOT NULL,
	`sync_run_id` integer,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "wishlist_ended_values" CHECK(ended IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_open_one` ON `wishlist_spans` (`platform`,`external_id`) WHERE ended = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_spans_platform_external_id_first_observed_at_unique` ON `wishlist_spans` (`platform`,`external_id`,`first_observed_at`);