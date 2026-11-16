CREATE TABLE `conversion` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`given_minor` integer NOT NULL,
	`received_minor` integer NOT NULL,
	`rate` text NOT NULL,
	`covered_minor` integer DEFAULT 0 NOT NULL,
	`gain_minor` integer DEFAULT 0 NOT NULL,
	`done_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversion_user_id_idx` ON `conversion` (`user_id`,`done_on`);--> statement-breakpoint
CREATE INDEX `conversion_cycle_id_idx` ON `conversion` (`cycle_id`);