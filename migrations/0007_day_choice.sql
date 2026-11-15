CREATE TABLE `day_choice` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`day_on` text NOT NULL,
	`choice` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_choice_user_day_idx` ON `day_choice` (`user_id`,`day_on`);--> statement-breakpoint
CREATE INDEX `day_choice_cycle_id_idx` ON `day_choice` (`cycle_id`);