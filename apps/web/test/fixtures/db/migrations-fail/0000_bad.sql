CREATE TABLE `fail_probe` (
	`id` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO `no_such_table` (`id`) VALUES (1);
