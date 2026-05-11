CREATE TABLE IF NOT EXISTS `wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`encrypted_mnemonic` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`hd_path` text NOT NULL,
	`hd_index` integer NOT NULL,
	`sol_balance` real,
	`selected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `accounts_public_key_unique` ON `accounts` (`public_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`type` text NOT NULL,
	`mint_address` text NOT NULL,
	`token_symbol` text,
	`status` text NOT NULL,
	`tx_signature` text,
	`amount_in` real,
	`amount_out` real,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `volume_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mint_address` text NOT NULL,
	`token_symbol` text,
	`account_ids` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`pattern` text DEFAULT 'random' NOT NULL,
	`min_amount_sol` real NOT NULL,
	`max_amount_sol` real NOT NULL,
	`min_delay_ms` integer NOT NULL,
	`max_delay_ms` integer NOT NULL,
	`total_duration_minutes` integer NOT NULL,
	`slippage_bps` integer DEFAULT 500 NOT NULL,
	`use_jito` integer DEFAULT true NOT NULL,
	`jito_tip_lamports` integer DEFAULT 10000 NOT NULL,
	`encrypted_password` text,
	`total_trades` integer DEFAULT 0 NOT NULL,
	`successful_trades` integer DEFAULT 0 NOT NULL,
	`failed_trades` integer DEFAULT 0 NOT NULL,
	`total_volume_sol` real DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`stopped_at` integer,
	`ends_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rpc_endpoint` text DEFAULT 'https://api.mainnet-beta.solana.com' NOT NULL,
	`helius_api_key` text,
	`jupiter_api_key` text,
	`jito_endpoint` text DEFAULT 'https://mainnet.block-engine.jito.wtf' NOT NULL,
	`default_slippage_bps` integer DEFAULT 500 NOT NULL,
	`default_jito_tip_lamports` integer DEFAULT 10000 NOT NULL,
	`default_delay_ms` integer DEFAULT 0 NOT NULL,
	`xai_api_key` text,
	`social_gate_accounts` text DEFAULT '["WatcherGuru","elonmusk","realDonaldTrump","ansemburner","cobie","CryptoCobain","blknoiz06","MustStopMurad","DegenSpartan","CryptoGodJohn"]' NOT NULL,
	`jwt_secret` text,
	`license_key` text,
	`license_instance_id` text,
	`license_status` text DEFAULT 'unchecked' NOT NULL,
	`license_expires_at` integer,
	`license_checked_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `distributor_wallet` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`encrypted_mnemonic` text NOT NULL,
	`public_key` text NOT NULL,
	`hd_path` text DEFAULT 'm/44''/501''/0''/0''' NOT NULL,
	`sol_balance` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `arb_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`account_id` integer NOT NULL,
	`mint_address` text NOT NULL,
	`token_symbol` text,
	`input_amount_sol` real NOT NULL,
	`min_profit_sol` real DEFAULT 0.001 NOT NULL,
	`jito_tip_lamports` integer DEFAULT 10000 NOT NULL,
	`scan_interval_ms` integer DEFAULT 5000 NOT NULL,
	`slippage_bps` integer DEFAULT 100 NOT NULL,
	`target_dexes` text DEFAULT '["Raydium","Raydium CLMM","Orca","Whirlpool","Meteora DLMM","Pump.fun AMM"]' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_arbs` integer DEFAULT 0 NOT NULL,
	`total_profit_sol` real DEFAULT 0 NOT NULL,
	`started_at` integer,
	`stopped_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `arb_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`config_id` integer NOT NULL,
	`type` text NOT NULL,
	`input_sol` real NOT NULL,
	`output_sol` real,
	`profit_sol` real,
	`status` text NOT NULL,
	`buy_dex` text,
	`sell_dex` text,
	`buy_tx_signature` text,
	`sell_tx_signature` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sniper_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`account_ids` text DEFAULT '[]' NOT NULL,
	`sol_per_account` real DEFAULT 0.1 NOT NULL,
	`max_buy_slippage_bps` integer DEFAULT 1500 NOT NULL,
	`min_liquidity_sol` real DEFAULT 1 NOT NULL,
	`exit_strategy` text DEFAULT 'timer' NOT NULL,
	`exit_timer_seconds` integer DEFAULT 300 NOT NULL,
	`exit_multiplier` real DEFAULT 2 NOT NULL,
	`use_jito` integer DEFAULT true NOT NULL,
	`jito_tip_lamports` integer DEFAULT 100000 NOT NULL,
	`target_dexes` text DEFAULT '["raydium","raydium_cpmm","pumpfun"]' NOT NULL,
	`max_snipes_per_pool` integer DEFAULT 1 NOT NULL,
	`enable_social_gate` integer DEFAULT false NOT NULL,
	`enable_cto_buy` integer DEFAULT false NOT NULL,
	`buy_mode` text DEFAULT 'fixed' NOT NULL,
	`buy_percent` real DEFAULT 90 NOT NULL,
	`stop_loss_pct` real DEFAULT 20 NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`total_snipes` integer DEFAULT 0 NOT NULL,
	`total_pnl_sol` real DEFAULT 0 NOT NULL,
	`started_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sniper_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`config_id` integer NOT NULL,
	`mint_address` text NOT NULL,
	`token_symbol` text,
	`token_name` text,
	`dex` text NOT NULL,
	`account_id` integer NOT NULL,
	`sol_spent` real NOT NULL,
	`tokens_received` real,
	`sol_received` real,
	`pnl_sol` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`buy_tx_signature` text,
	`sell_tx_signature` text,
	`error` text,
	`detected_at` integer NOT NULL,
	`bought_at` integer,
	`sold_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `token_radar` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mint_address` text NOT NULL,
	`dex` text NOT NULL,
	`signature` text NOT NULL,
	`token_name` text,
	`token_symbol` text,
	`token_uri` text,
	`is_graduation` integer DEFAULT false NOT NULL,
	`pool_address` text,
	`detected_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`mint_address` text NOT NULL,
	`account_ids` text NOT NULL,
	`password` text NOT NULL,
	`slippage_bps` integer DEFAULT 1500 NOT NULL,
	`dca_amount_sol` real,
	`dca_interval_sec` integer,
	`dca_rounds_total` integer,
	`dca_rounds_done` integer DEFAULT 0 NOT NULL,
	`trigger_price_usd` real,
	`trigger_condition` text,
	`sell_pct` real,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_result` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `auth_username_unique` ON `auth` (`username`);