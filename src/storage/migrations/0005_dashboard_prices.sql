CREATE TABLE `price_history` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`close` integer NOT NULL,
	`currency` text NOT NULL,
	PRIMARY KEY(`symbol`, `date`)
);
--> statement-breakpoint
CREATE INDEX `price_history_symbol` ON `price_history` (`symbol`);
--> statement-breakpoint
CREATE TABLE `fx_history` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`date` text NOT NULL,
	`rate` integer NOT NULL,
	PRIMARY KEY(`base`, `quote`, `date`)
);
