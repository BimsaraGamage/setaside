CREATE TABLE `savings_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`kind` text NOT NULL,
	`moved_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_movement_user_id_idx` ON `savings_movement` (`user_id`,`moved_on`);--> statement-breakpoint
CREATE INDEX `savings_movement_cycle_id_idx` ON `savings_movement` (`cycle_id`);