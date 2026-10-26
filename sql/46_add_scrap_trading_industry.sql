-- Adds 'scrap_trading' as a new industry_type value.
--
-- Run this file BY ITSELF, same reason sql/13 (which added 'warehouse') had
-- to be: Postgres will not let a statement use a brand-new enum value in
-- the same transaction that added the value. sql/47_scrap_trading_followup.sql
-- (document requirements, the public sign-up form's industry whitelist,
-- RFQ requirement industry whitelist) depends on this having already
-- committed -- run it only after this one finishes.
alter type industry_type add value if not exists 'scrap_trading';
