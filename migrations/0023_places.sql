CREATE TABLE `place` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`kind` text DEFAULT 'spending' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `place_user_id_idx` ON `place` (`user_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `place_check` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`place_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`checked_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `place_check_user_id_idx` ON `place_check` (`user_id`);--> statement-breakpoint
CREATE INDEX `place_check_place_id_idx` ON `place_check` (`place_id`,`checked_at`);