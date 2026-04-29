-- Allow multiple existing_doc_id rows per (broker, external_id) so a broker
-- trade can be linked to several Wallet entries (e.g. when IBKR splits an
-- order into partial fills but the user manually entered them all together).
ALTER TABLE `manual_link` RENAME TO `manual_link_old`;
--> statement-breakpoint
CREATE TABLE `manual_link` (
	`broker` text NOT NULL,
	`external_id` text NOT NULL,
	`existing_doc_id` text NOT NULL,
	PRIMARY KEY(`broker`, `external_id`, `existing_doc_id`)
);
--> statement-breakpoint
INSERT INTO `manual_link` (`broker`, `external_id`, `existing_doc_id`)
  SELECT `broker`, `external_id`, `existing_doc_id` FROM `manual_link_old`;
--> statement-breakpoint
DROP TABLE `manual_link_old`;
