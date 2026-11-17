CREATE TABLE IF NOT EXISTS `retirement_account` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('pilon1', 'pilon2', 'pilon3', 'unit-linked')),
	`provider` text NOT NULL,
	`product` text NOT NULL,
	`contract` text NOT NULL,
	`currency` text NOT NULL,
	`release_date` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `retirement_statement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL REFERENCES `retirement_account`(`id`),
	`as_of` text NOT NULL,
	`value` integer,
	`paid_in` integer,
	`fees` integer,
	`details` text,
	`file_hash` text NOT NULL UNIQUE,
	`uploaded_at` text NOT NULL,
	UNIQUE (`account_id`, `as_of`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `retirement_contribution` (
	`account_id` text NOT NULL REFERENCES `retirement_account`(`id`),
	`date` text NOT NULL,
	`gross` integer NOT NULL,
	`fee` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `retirement_contribution_account` ON `retirement_contribution` (`account_id`);
