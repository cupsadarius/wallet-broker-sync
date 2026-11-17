CREATE TABLE `maturity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`account_id` text,
	`symbol` text,
	`currency` text NOT NULL,
	`principal` integer NOT NULL,
	`rate_bps` integer,
	`start_date` text,
	`maturity_date` text NOT NULL
);
