CREATE TABLE `commitment_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`commitment_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`paid_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`commitment_id`) REFERENCES `commitment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `commitment_payment_user_id_idx` ON `commitment_payment` (`user_id`);--> statement-breakpoint
CREATE INDEX `commitment_payment_commitment_id_idx` ON `commitment_payment` (`commitment_id`,`paid_on`);