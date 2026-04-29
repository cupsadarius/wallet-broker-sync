CREATE TABLE `couch_doc_cache` (
	`scope` text NOT NULL,
	`doc_id` text NOT NULL,
	`model_type` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`scope`, `doc_id`)
);
--> statement-breakpoint
CREATE INDEX `couch_doc_cache_scope_type` ON `couch_doc_cache` (`scope`, `model_type`);
--> statement-breakpoint
CREATE TABLE `couch_cache_meta` (
	`scope` text PRIMARY KEY NOT NULL,
	`last_seq` text NOT NULL
);
