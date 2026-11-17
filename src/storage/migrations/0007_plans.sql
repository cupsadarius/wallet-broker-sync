CREATE TABLE `plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('recurring', 'rollover')),
	`name` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer,
	`currency` text,
	`frequency` text CHECK (`frequency` IN ('weekly', 'monthly')),
	`start_date` text NOT NULL,
	`target_symbol` text,
	`whole_shares` integer DEFAULT 0 NOT NULL,
	`maturity_id` integer REFERENCES `maturity`(`id`) ON DELETE SET NULL,
	`target_product` text,
	`status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'paused', 'archived')),
	CHECK (`type` = 'rollover' OR (`amount` IS NOT NULL AND `currency` IS NOT NULL AND `frequency` IS NOT NULL)),
	CHECK (`type` = 'recurring' OR `target_product` IS NOT NULL)
);
