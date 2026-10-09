CREATE TABLE `fk_parent` (
	`id` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fk_child` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_id` integer REFERENCES `fk_parent`(`id`)
);
--> statement-breakpoint
INSERT INTO `fk_child` (`id`, `parent_id`) VALUES (1, 999);
