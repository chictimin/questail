DROP INDEX `sync_runs_source_started_at_unique`;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `generation` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `failed_items` integer;--> statement-breakpoint
UPDATE `sync_runs` AS `o` SET `generation` = COALESCE((SELECT `generation` FROM `sync_generations` WHERE `source` = `o`.`source`), 0) + (SELECT COUNT(*) FROM `sync_runs` AS `i` WHERE `i`.`source` = `o`.`source` AND `i`.`id` <= `o`.`id`);--> statement-breakpoint
INSERT INTO `sync_generations` (`source`, `generation`) SELECT `source`, MAX(`generation`) FROM `sync_runs` GROUP BY `source` ON CONFLICT(`source`) DO UPDATE SET `generation` = excluded.`generation` WHERE excluded.`generation` > `sync_generations`.`generation`;--> statement-breakpoint
CREATE UNIQUE INDEX `sync_runs_source_generation_unique` ON `sync_runs` (`source`,`generation`);
