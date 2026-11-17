CREATE TABLE `rule_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`keywords` text NOT NULL,
	`category_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'approved', 'rejected')),
	`created_at` text NOT NULL
);
