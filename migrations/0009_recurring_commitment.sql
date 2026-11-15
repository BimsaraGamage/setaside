CREATE TABLE `recurring_commitment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'bill' NOT NULL,
	`currency` text NOT NULL,
	`usual_amount_minor` integer NOT NULL,
	`usual_day` integer NOT NULL,
	`card_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_commitment_user_id_idx` ON `recurring_commitment` (`user_id`);