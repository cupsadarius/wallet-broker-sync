CREATE TABLE `asset_alias` (
	`broker` text NOT NULL,
	`from_symbol` text NOT NULL,
	`from_exchange` text NOT NULL,
	`to_symbol` text NOT NULL,
	`to_exchange` text NOT NULL,
	PRIMARY KEY(`broker`, `from_symbol`, `from_exchange`)
);
