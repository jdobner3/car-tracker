-- The two cars and their factory maintenance schedules.
-- RAV4: Toyota Warranty & Maintenance Guide (T-MMS-24RAV4HV), normal conditions.
-- Terrain: 2019 GMC Terrain owner's manual, "Additional Required Services - Normal" (pp. 380-381), diesel rows.

INSERT INTO vehicles (id, name, year, make, model, trim, engine, oil_spec, sort) VALUES
  (1, 'Justin''s RAV4', 2024, 'Toyota', 'RAV4 Hybrid', 'Limited', '2.5L hybrid',
      'SAE 0W-16 (0W-20 OK in a pinch). 4.5 qt with filter.', 1),
  (2, 'Kelsey''s Terrain', 2019, 'GMC', 'Terrain', 'SLT', '1.6L turbo diesel',
      'dexos2-approved SAE 5W-30 (ACDelco dexos2 recommended).', 2);

-- RAV4 Hybrid ------------------------------------------------------------------
INSERT INTO items (vehicle_id, name, interval_miles, interval_months, first_miles, first_months, notes, source, sort) VALUES
  (1, 'Engine oil & filter', 10000, 12, NULL, NULL,
      'Reset the oil maintenance reminder afterward. Change at 5,000 mi if you drive mostly short trips in freezing weather, on dusty roads, or tow.',
      'Toyota maintenance guide', 10),
  (1, 'Tire rotation', 5000, 6, NULL, NULL, NULL, 'Toyota maintenance guide', 20),
  (1, 'Multi-point inspection', 5000, 6, NULL, NULL,
      'Toyota''s every-5,000-mile checks: brake pads/discs, all fluid levels, wiper blades, HV battery cooling intake filter.',
      'Toyota maintenance guide', 30),
  (1, 'Clean HV battery cooling intake filter', 20000, 24, NULL, NULL,
      'Air intake vent under the right side of the rear seat (owner''s manual p. 425). Check it every 5,000 mi and clean early if dusty.', 'Toyota maintenance guide', 40),
  (1, 'Cabin air filter', 30000, 36, NULL, NULL,
      'Inspected at 15,000 mi. Replace sooner if airflow drops or windows fog.', 'Toyota maintenance guide', 50),
  (1, 'Engine air filter', 30000, 36, NULL, NULL, NULL, 'Toyota maintenance guide', 60),
  (1, 'Spark plugs', 120000, 144, NULL, NULL, NULL, 'Toyota maintenance guide', 70),
  (1, 'Engine coolant', 50000, 60, 100000, 120,
      NULL, 'Toyota maintenance guide', 80),
  (1, 'Inverter coolant', 50000, 60, 150000, 180,
      NULL, 'Toyota maintenance guide', 90),
  (1, 'Transmission fluid & rear differential oil', NULL, NULL, NULL, NULL,
      'Only required if you tow, use a roof carrier, or haul heavy loads: then every 60,000 mi.', 'Toyota maintenance guide', 100),
  (1, 'Wiper blades', NULL, NULL, NULL, NULL, 'Inspected every 5,000 mi; replace when streaking.', NULL, 110),
  (1, 'Brake pads / rotors', NULL, NULL, NULL, NULL, NULL, NULL, 120),
  (1, 'Tires replaced', NULL, NULL, NULL, NULL, NULL, NULL, 130),
  (1, 'Wheel alignment', NULL, NULL, NULL, NULL, NULL, NULL, 140),
  (1, '12V battery', NULL, NULL, NULL, NULL, NULL, NULL, 150);

-- 2019 Terrain 1.6L diesel --------------------------------------------------------
INSERT INTO items (vehicle_id, name, interval_miles, interval_months, first_miles, first_months, notes, source, sort) VALUES
  (2, 'Engine oil & filter', 7500, 12, NULL, NULL,
      'Change when the oil life monitor says to, at least every 7,500 mi or once a year. Reset the oil life system afterward.',
      'GMC owner''s manual p. 380', 10),
  (2, 'Tire rotation & required services', 7500, NULL, NULL, NULL,
      'Rotate tires, check oil level, and do GM''s list of required checks (brakes, steering, suspension, fluids, belts).',
      'GMC owner''s manual p. 380', 20),
  (2, 'Drain water from diesel fuel filter', 7500, NULL, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 30),
  (2, 'Diesel fuel filter', 30000, 24, NULL, NULL,
      'Or when the Driver Information Center says to. More often with biodiesel, dust, or towing.',
      'GMC owner''s manual p. 380', 40),
  (2, 'Cabin air filter', 22500, 24, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 50),
  (2, 'Engine air filter', 45000, 48, NULL, NULL, 'If driving in dust, inspect at every oil change.', 'GMC owner''s manual p. 380', 60),
  (2, 'Inspect evaporative control system', 45000, NULL, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 70),
  (2, 'Wiper blades', 15000, 12, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 80),
  (2, 'Brake fluid', NULL, 60, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 90),
  (2, 'Hood / liftgate gas struts', 75000, NULL, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 100),
  (2, 'Engine coolant drain & fill', 150000, 60, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 110),
  (2, 'Inspect accessory drive belt', 150000, 120, NULL, NULL, NULL, 'GMC owner''s manual p. 380', 120),
  (2, 'Diesel exhaust fluid (DEF) refill', NULL, NULL, NULL, NULL,
      'Fill when the DIC shows the DEF level is low.', 'GMC owner''s manual', 130),
  (2, 'Transmission fluid', NULL, NULL, NULL, NULL,
      'Not on GM''s normal schedule. Severe use (towing, heavy traffic, extreme heat): every 45,000 mi.', 'GMC owner''s manual p. 382', 140),
  (2, 'Brake pads / rotors', NULL, NULL, NULL, NULL, NULL, NULL, 150),
  (2, 'Tires replaced', NULL, NULL, NULL, NULL, NULL, NULL, 160),
  (2, 'Wheel alignment', NULL, NULL, NULL, NULL, NULL, NULL, 170),
  (2, '12V battery', NULL, NULL, NULL, NULL, NULL, NULL, 180);
