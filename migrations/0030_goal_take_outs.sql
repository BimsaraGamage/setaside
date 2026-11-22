ALTER TABLE `savings_movement` ADD `goal_id` text;--> statement-breakpoint
CREATE INDEX `savings_movement_goal_id_idx` ON `savings_movement` (`goal_id`);