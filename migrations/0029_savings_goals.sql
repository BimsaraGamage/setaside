CREATE TABLE `savings_goal` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`target_minor` integer NOT NULL,
	`by_on` text NOT NULL,
	`start_minor` integer DEFAULT 0 NOT NULL,
	`stopped` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_goal_user_id_idx` ON `savings_goal` (`user_id`);--> statement-breakpoint
ALTER TABLE `commitment` ADD `goal_id` text;--> statement-breakpoint
CREATE INDEX `commitment_goal_id_idx` ON `commitment` (`goal_id`);