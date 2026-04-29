CREATE TABLE `manual_link` (
	`broker` text NOT NULL,
	`external_id` text NOT NULL,
	`existing_doc_id` text NOT NULL,
	PRIMARY KEY(`broker`, `external_id`)
);
--> statement-breakpoint
CREATE TABLE `record_fallback` (
	`broker` text NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	PRIMARY KEY(`broker`, `exchange`, `symbol`)
);
