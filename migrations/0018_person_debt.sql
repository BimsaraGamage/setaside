CREATE TABLE `person_debt` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`person_name` text NOT NULL,
	`direction` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`made_on` text NOT NULL,
	`settled_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `person_debt_user_id_idx` ON `person_debt` (`user_id`);--> statement-breakpoint
CREATE INDEX `person_debt_cycle_id_idx` ON `person_debt` (`cycle_id`);