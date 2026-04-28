CREATE TABLE `broker_account_map` (
	`broker` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`currency_code` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`broker` text NOT NULL,
	`account_id` text NOT NULL,
	`source_filename` text NOT NULL,
	`source_sha256` text NOT NULL,
	`parsed_count` integer NOT NULL,
	`inserted_count` integer NOT NULL,
	`conflict_count` integer NOT NULL,
	`error_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_run_doc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`external_id` text,
	`doc_id` text,
	`status` text NOT NULL,
	`error_message` text
);
