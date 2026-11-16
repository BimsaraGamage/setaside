CREATE TABLE `instalment_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`price_minor` integer NOT NULL,
	`payment_count` integer NOT NULL,
	`payment_minor` integer NOT NULL,
	`first_payment_on` text NOT NULL,
	`card_id` text,
	`normal_monthly_minor` integer,
	`paid_off_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `instalment_plan_user_id_idx` ON `instalment_plan` (`user_id`);--> statement-breakpoint
CREATE TABLE `plan_extra_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`paid_from` text NOT NULL,
	`pays_off` integer DEFAULT false NOT NULL,
	`paid_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `instalment_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_extra_payment_user_id_idx` ON `plan_extra_payment` (`user_id`);--> statement-breakpoint
CREATE INDEX `plan_extra_payment_plan_id_idx` ON `plan_extra_payment` (`plan_id`);