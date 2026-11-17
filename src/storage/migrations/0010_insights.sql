CREATE TABLE IF NOT EXISTS `budget_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`current_limit` integer NOT NULL,
	`limit` integer NOT NULL CHECK (`limit` > 0),
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'approved', 'rejected')),
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `weekly_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('ok', 'flagged')),
	`problem` text,
	`created_at` text NOT NULL
);
