// Builds public/codes.json (the trouble-code lookup) from data/dtc/.
// Run: node scripts/build-codes.mjs
//
// Source: github.com/fabiovila/OBDIICodes codes.json (MIT, see data/dtc/fabiovila-LICENSE.txt),
// generic SAE J2012 powertrain codes, plus data/dtc/supplement.json for standard hybrid/network codes it lacks.
// Manufacturer-specific code lists found online (P1xxx, B1/C1/U1) were left out on purpose: the ones available
// are Ford or 1990s GM tables and would give wrong answers for a 2019 GMC or 2024 Toyota.

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = JSON.parse(readFileSync(`${root}data/dtc/fabiovila-codes.json`, 'utf8'));
const supplement = JSON.parse(readFileSync(`${root}data/dtc/supplement.json`, 'utf8')).codes;

const codes = new Map();
for (const { Code, Description } of src) {
  // Some rows have the first word(s) of the description stuck to the code: "P2765/Turbine" + "Speed Sensor...".
  let [code, spill] = Code.trim().split(/\/(.*)/);
  code = code.toUpperCase();
  if (spill === 'SAE') spill = '';
  if (spill === 'C') spill = 'A/C';                    // "P2515/C" was "A/C Refrigerant..."
  const desc = `${spill ? `${spill} ` : ''}${Description.trim()}`
    .replace(/([a-z)])([A-H])(?=[A-Z])/g, '$1 $2 ')   // "HeaterAControl" -> "Heater A Control"
    .replace(/([a-z])([A-H])(?= \/)/g, '$1 $2')       // "SwitchC / F" -> "Switch C / F"
    .replace(/(\s)([A-H])(?=[A-Z][a-z])/g, '$1$2 ')   // " FVoltage" -> " F Voltage"
    .replace(/\s+/g, ' ')
    .replace(/–/g, '-')
    .trim();
  if (!/^[PBCU][0-9A-F]{4}$/.test(code)) continue;  // drops "P0000/SAE", "P340A," range rows
  if (/reserved/i.test(desc)) continue;
  if (!codes.has(code)) codes.set(code, desc);
}
for (const [code, desc] of supplement) if (!codes.has(code)) codes.set(code, desc);

const out = [...codes].sort(([a], [b]) => a.localeCompare(b));
writeFileSync(`${root}public/codes.json`, JSON.stringify(out));
copyFileSync(`${root}data/dtc/fabiovila-LICENSE.txt`, `${root}public/codes-LICENSE.txt`);
console.log(`${out.length} codes written to public/codes.json`);
