CREATE TABLE `spend` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`spent_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`note` text,
	`pot_id` text,
	`card_id` text,
	`one_off` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `spend_user_id_idx` ON `spend` (`user_id`);--> statement-breakpoint
CREATE INDEX `spend_cycle_id_idx` ON `spend` (`cycle_id`,`spent_on`);