CREATE TABLE `commitment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`recurring_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'bill' NOT NULL,
	`currency` text NOT NULL,
	`planned_minor` integer NOT NULL,
	`due_on` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`carried_from_id` text,
	`card_id` text,
	`plan_id` text,
	`person_debt_id` text,
	`prepayment_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `commitment_user_id_idx` ON `commitment` (`user_id`);--> statement-breakpoint
CREATE INDEX `commitment_cycle_id_idx` ON `commitment` (`cycle_id`,`due_on`);