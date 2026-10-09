CREATE TABLE `legacy_kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `legacy_ratings` (
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`score` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`platform`, `external_id`)
);
