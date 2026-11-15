CREATE TABLE `pot` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`usual_amount_minor` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pot_user_id_idx` ON `pot` (`user_id`);--> statement-breakpoint
CREATE TABLE `pot_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `pot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pot_allocation_user_id_idx` ON `pot_allocation` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pot_allocation_pot_cycle_idx` ON `pot_allocation` (`pot_id`,`cycle_id`);