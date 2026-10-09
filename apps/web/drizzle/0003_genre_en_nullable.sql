PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game_genres` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`genre_id` text NOT NULL,
	`genre_name_en` text,
	`genre_name_ko` text,
	`position` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`sync_run_id` integer,
	PRIMARY KEY(`platform`, `external_id`, `genre_id`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform`,`external_id`) REFERENCES `games`(`platform`,`external_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_game_genres`("platform", "external_id", "genre_id", "genre_name_en", "genre_name_ko", "position", "observed_at", "sync_run_id") SELECT "platform", "external_id", "genre_id", "genre_name_en", "genre_name_ko", "position", "observed_at", "sync_run_id" FROM `game_genres`;--> statement-breakpoint
DROP TABLE `game_genres`;--> statement-breakpoint
ALTER TABLE `__new_game_genres` RENAME TO `game_genres`;--> statement-breakpoint
PRAGMA foreign_keys=ON;