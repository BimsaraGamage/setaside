CREATE TABLE `prepayment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`total_minor` integer NOT NULL,
	`payback_minor` integer NOT NULL,
	`normal_monthly_minor` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prepayment_user_id_idx` ON `prepayment` (`user_id`);--> statement-breakpoint
ALTER TABLE `savings_movement` ADD `prepayment_id` text;