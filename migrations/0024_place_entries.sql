CREATE TABLE `place_move` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`from_place_id` text NOT NULL,
	`to_place_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `place_move_user_id_idx` ON `place_move` (`user_id`);--> statement-breakpoint
CREATE INDEX `place_move_from_idx` ON `place_move` (`from_place_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `place_move_to_idx` ON `place_move` (`to_place_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `commitment_payment` ADD `place_id` text;--> statement-breakpoint
CREATE INDEX `commitment_payment_place_id_idx` ON `commitment_payment` (`place_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `spend` ADD `place_id` text;--> statement-breakpoint
CREATE INDEX `spend_place_id_idx` ON `spend` (`place_id`,`created_at`);