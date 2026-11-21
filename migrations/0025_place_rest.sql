ALTER TABLE `conversion` ADD `from_place_id` text;--> statement-breakpoint
ALTER TABLE `conversion` ADD `to_place_id` text;--> statement-breakpoint
CREATE INDEX `conversion_from_place_idx` ON `conversion` (`from_place_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `conversion_to_place_idx` ON `conversion` (`to_place_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `income` ADD `place_id` text;--> statement-breakpoint
CREATE INDEX `income_place_id_idx` ON `income` (`place_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `person_debt` ADD `place_id` text;--> statement-breakpoint
CREATE INDEX `person_debt_place_id_idx` ON `person_debt` (`place_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `plan_extra_payment` ADD `place_id` text;--> statement-breakpoint
CREATE INDEX `plan_extra_payment_place_id_idx` ON `plan_extra_payment` (`place_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `savings_movement` ADD `place_id` text;--> statement-breakpoint
CREATE INDEX `savings_movement_place_id_idx` ON `savings_movement` (`place_id`,`created_at`);