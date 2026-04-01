alter table site_settings
  add column if not exists default_hourly_rate_usd numeric(12,2) default 150.00;

update site_settings
set default_hourly_rate_usd = 150.00
where default_hourly_rate_usd is null;

alter table site_settings
  alter column default_hourly_rate_usd set default 150.00;

alter table site_settings
  drop constraint if exists site_settings_default_hourly_rate_usd_range;

alter table site_settings
  add constraint site_settings_default_hourly_rate_usd_range
  check (default_hourly_rate_usd >= 0 and default_hourly_rate_usd <= 999999.99);
