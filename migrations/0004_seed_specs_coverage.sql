-- Parts card, warranties, renewals, and recall lookups for the two cars.
-- RAV4: 2024 RAV4 Hybrid owner's manual (OM0R149U) ch. 8-1 Specifications; Toyota Warranty & Maintenance
--   Guide T-MMS-24RAV4HV; plate renewal notice and Farmers renewal in Documents\Car.
-- Terrain: 2019 Terrain owner's manual pp. 387-393 (fluids, GM/ACDelco part numbers, capacities).

UPDATE vehicles SET recall_models = 'RAV4 Hybrid,RAV4' WHERE id = 1;
UPDATE vehicles SET recall_models = 'Terrain' WHERE id = 2;

-- RAV4 ---------------------------------------------------------------------------
INSERT INTO specs (vehicle_id, item, ask_for, part_numbers, notes, sort) VALUES
  (1, 'Engine oil', 'SAE 0W-16 full synthetic, 5 qt (takes 4.5 qt with filter)', NULL,
      '0W-20 is OK to top off; go back to 0W-16 at the next change.', 10),
  (1, 'Oil filter', 'Oil filter for a 2024 RAV4 Hybrid, 2.5L A25A-FXS engine', NULL,
      'Part # isn''t in the manual. Add it from your next oil change receipt.', 20),
  (1, 'Engine air filter', 'Engine air filter for a 2024 RAV4 Hybrid 2.5L', NULL, NULL, 30),
  (1, 'Cabin air filter', 'Cabin air filter for a 2024 RAV4 Hybrid', NULL, NULL, 40),
  (1, 'Wiper blades', 'Front wiper blades (driver + passenger) and rear blade for a 2024 RAV4', NULL,
      'Sizes aren''t in the manual. The store''s lookup book has them; add them here once you know.', 50),
  (1, 'Tires', '225/60R18 100H, 33 psi front and rear (cold)', NULL,
      'Limited = 18-inch wheels. Confirm on the driver''s door sticker. Spare: T165/80D17 at 60 psi. Lug nuts 76 ft-lb.', 60),
  (1, 'Spark plugs', 'DENSO FC16HR-Q8 iridium', NULL,'Gap 0.031 in. Don''t re-gap iridium plugs.', 70),
  (1, 'Coolant', 'Toyota Super Long Life Coolant (pink, premixed)', NULL,
      'Engine system 6.4 qt, inverter system 1.7 qt. Never plain water.', 80),
  (1, 'Brake fluid', 'DOT 3 or DOT 4', NULL, NULL, 90),
  (1, 'Transmission / rear diff fluid', 'Toyota Genuine ATF WS', NULL, 'Dealer item: 4.1 qt transmission, 1.8 qt rear diff.', 100),
  (1, 'Fuel', '87 octane unleaded', NULL, '14.5 gal tank.', 110),
  (1, 'Bulbs', 'Front turn/parking 7444NA · rear turn WY21W · back-up W16W · side markers W5W', NULL,
      'Headlights and most other lights are LED (dealer).', 120),
  (1, '12V battery', '12V battery for a 2024 RAV4 Hybrid', NULL,
      'Read the group size off the label on the current battery before buying.', 130);

INSERT INTO reminders (vehicle_id, kind, title, months, miles_limit, notes, source, sort) VALUES
  (1, 'warranty', 'Basic (bumper to bumper)', 36, 36000, 'A/C recharge, alignment and balancing: 12 months / 12,000 mi.', 'Toyota warranty guide', 10),
  (1, 'warranty', 'Powertrain', 60, 60000, NULL, 'Toyota warranty guide', 20),
  (1, 'warranty', 'Hybrid system', 96, 100000, 'Hybrid components listed in the warranty guide (power management module, battery sensors, etc.).', 'Toyota warranty guide', 30),
  (1, 'warranty', 'Hybrid battery', 120, 150000, NULL, 'Toyota warranty guide', 40),
  (1, 'warranty', 'Restraint systems (airbags, seat belts)', 60, 60000, NULL, 'Toyota warranty guide', 50),
  (1, 'warranty', 'Major emissions parts', 96, 80000, 'Catalytic converter, engine computer.', 'Toyota warranty guide', 60),
  (1, 'warranty', 'Rust-through', 60, NULL, 'Any mileage.', 'Toyota warranty guide', 70);

INSERT INTO reminders (vehicle_id, kind, title, due_date, repeat_months, notes, source, sort) VALUES
  (1, 'renewal', 'Plate sticker (Illinois)', '2027-02-28', 12, 'Renew at ilsos.gov.', 'IL renewal notice, renewed Feb 2026', 10),
  (1, 'renewal', 'Car insurance (Farmers)', '2027-01-27', 6, '6-month policy term.', 'Farmers renewal notice', 20);

-- Terrain ------------------------------------------------------------------------
INSERT INTO specs (vehicle_id, item, ask_for, part_numbers, notes, sort) VALUES
  (2, 'Engine oil', 'dexos2-approved SAE 5W-30, 6 qt (takes 5.3 qt with filter)', 'ACDelco dexos2 recommended',
      'Must say dexos2 (diesel). dexos1 is the gas-engine oil.', 10),
  (2, 'Oil filter', 'ACDelco PF2264G', 'ACDelco PF2264G · GM 55588497', NULL, 20),
  (2, 'Fuel filter', 'ACDelco TP1016', 'ACDelco TP1016 · GM 84186990', NULL, 30),
  (2, 'Engine air filter', 'ACDelco A3226C', 'ACDelco A3226C · GM 23279657', NULL, 40),
  (2, 'Cabin air filter', 'ACDelco CF185', 'ACDelco CF185 · GM 13508023', NULL, 50),
  (2, 'Wiper blades', '24" driver, 18" passenger, 12" rear', 'GM 23368186 · 23353587 · 84215609',
      'Manual sizes: 23.6 in, 17.7 in, 11.8 in.', 60),
  (2, 'DEF (diesel exhaust fluid)', 'Any DEF with the API certified mark (ISO 22241)', 'GM 19286291', NULL, 70),
  (2, 'Fuel', 'Diesel only (ultra-low sulfur)', NULL, 'Never gasoline.', 80),
  (2, 'Coolant', 'DEX-COOL, 50/50 with clean water', NULL, 'System holds 7.9 qt.', 90),
  (2, 'Brake fluid', 'DOT 3', 'GM 19353126', NULL, 100),
  (2, 'Transmission fluid', 'DEXRON-VI', NULL, NULL, 110),
  (2, 'Tires', 'Size and pressure are on the driver''s door sticker', NULL, 'Lug nuts 100 lb-ft.', 120);

INSERT INTO reminders (vehicle_id, kind, title, months, miles_limit, notes, source, sort) VALUES
  (2, 'warranty', 'Bumper to bumper', 36, 36000, NULL, 'GM standard 2019 terms (not in your files; verify)', 10),
  (2, 'warranty', 'Powertrain', 60, 60000, NULL, 'GM standard 2019 terms (not in your files; verify)', 20),
  (2, 'warranty', 'Major emissions parts (federal)', 96, 80000, 'Catalytic converter and engine computer, by federal law.', 'Federal emissions warranty', 30);
