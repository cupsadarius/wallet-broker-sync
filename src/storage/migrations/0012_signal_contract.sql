-- Signal Iduna statements carry a "/N" suffix on the policy number that changes between statements.
INSERT INTO `retirement_account` (`id`, `kind`, `provider`, `product`, `contract`, `currency`, `release_date`, `created_at`)
SELECT substr(`id`, 1, instr(`id`, '/') - 1), `kind`, `provider`, `product`, substr(`contract`, 1, instr(`contract`, '/') - 1), `currency`, `release_date`, `created_at`
FROM `retirement_account` WHERE `id` LIKE 'signal-iduna:%/%';
--> statement-breakpoint
UPDATE `retirement_statement` SET `account_id` = substr(`account_id`, 1, instr(`account_id`, '/') - 1) WHERE `account_id` LIKE 'signal-iduna:%/%';
--> statement-breakpoint
UPDATE `retirement_contribution` SET `account_id` = substr(`account_id`, 1, instr(`account_id`, '/') - 1) WHERE `account_id` LIKE 'signal-iduna:%/%';
--> statement-breakpoint
DELETE FROM `retirement_account` WHERE `id` LIKE 'signal-iduna:%/%';
