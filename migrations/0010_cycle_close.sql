CREATE TABLE `cycle_close` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`next_cycle_id` text NOT NULL,
	`currency` text NOT NULL,
	`leftover_correction_minor` integer DEFAULT 0 NOT NULL,
	`leftover_to_savings_minor` integer DEFAULT 0 NOT NULL,
	`overspend_choice` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cycle_close_user_id_idx` ON `cycle_close` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_close_cycle_currency_idx` ON `cycle_close` (`cycle_id`,`currency`);