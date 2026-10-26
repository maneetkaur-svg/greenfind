-- Service categories for Scrap Trading. No sub-categories for any of these,
-- by design — service_subcategory stays empty for this industry, which the
-- app already handles (the Service step skips the sub-category block
-- entirely for a category with zero subs, same as it already does for any
-- other category with none).
--
-- Fixed one typo from the source list ("PET Bottels" -> "PET Bottles") in
-- the label shown to vendors/staff; the underlying intent is unchanged.
insert into public.service_category (industry, code, label, sort, is_active)
values
  ('scrap_trading', 'pet',       'PET Bottles', 1, true),
  ('scrap_trading', 'ldpe',      'LDPE',        2, true),
  ('scrap_trading', 'copper',    'Copper',      3, true),
  ('scrap_trading', 'aluminum',  'Aluminum',    4, true),
  ('scrap_trading', 'milkpouch', 'Milk Pouch',  5, true),
  ('scrap_trading', 'ubccans',   'UBC Cans',    6, true),
  ('scrap_trading', 'other',     'Other',       7, true)
on conflict (industry, code) do nothing;
