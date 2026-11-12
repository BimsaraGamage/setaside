CREATE TABLE `cycle` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_on` text NOT NULL,
	`expected_salary_on` text NOT NULL,
	`reserve_rate` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cycle_user_id_idx` ON `cycle` (`user_id`,`started_on`);--> statement-breakpoint
CREATE TABLE `income` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`received_on` text NOT NULL,
	`to_savings_minor` integer DEFAULT 0 NOT NULL,
	`person_debt_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `income_user_id_idx` ON `income` (`user_id`);--> statement-breakpoint
CREATE INDEX `income_cycle_id_idx` ON `income` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`salary_currency` text NOT NULL,
	`spending_currency` text NOT NULL,
	`home_time_zone` text NOT NULL,
	`usual_pay_day` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_user_id_unique` ON `settings` (`user_id`);