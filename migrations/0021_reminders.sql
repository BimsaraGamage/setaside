ALTER TABLE `settings` ADD `remind_due_soon` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `remind_due_today` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `remind_running_out` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `remind_salary_late` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `remind_questions` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `remind_spend_nudge` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `morning_at` text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `nudge_at` text DEFAULT '21:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `due_soon_days` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `banner_dismissed` integer DEFAULT false NOT NULL;