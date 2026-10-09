PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text,
	`title_ko` text,
	`developer_raw` text,
	`release_date_text` text,
	`release_date` integer,
	`cover_url` text,
	PRIMARY KEY(`platform`, `external_id`)
);
--> statement-breakpoint
INSERT INTO `__new_games`("platform", "external_id", "name", "title_ko", "developer_raw", "release_date_text", "release_date", "cover_url") SELECT "platform", "external_id", "name", "title_ko", "developer_raw", "release_date_text", "release_date", "cover_url" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;