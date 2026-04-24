import 'dotenv/config';
import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { connectDB } from '../config/db';
import {
  ReimputationRuleModel,
  AnulacionRuleModel,
  SubrubroMapModel,
} from '../models';

/**
 * Idempotent seeder for the 3 rule collections.
 *
 * Reads JSON files under src/seed/data/ and upserts via bulkWrite, keyed by
 * each collection's natural unique index:
 *   - reimputation_rules: { desde.nombreCuenta, desde.nombreSubcuenta }
 *   - anulacion_rules:    { cuenta.nombreCuenta, subcuenta.nombreSubcuenta }
 *   - subrubro_map:       { nombreCuentaReimputada }
 *
 * Running this multiple times is safe — existing docs are replaced, new ones
 * are inserted. Nothing else is touched.
 *
 * Usage:
 *   npm run seed:rules
 */

type ReimputationRaw = {
  desde: {
    numeroCuenta: number;
    nombreCuenta: string;
    numeroSubcuenta: number | null;
    nombreSubcuenta: string | null;
  };
  hacia: {
    numeroCuenta: number | string;
    nombreCuenta: string;
  };
};

type AnulacionRaw = {
  cuenta: { numeroCuenta: number; nombreCuenta: string };
  subcuenta: { numeroSubcuenta: number; nombreSubcuenta: string };
};

type SubrubroRaw = {
  nombreCuentaReimputada: string;
  nombreSubrubro: string;
};

const loadJson = <T>(fileName: string): T => {
  const fullPath = resolve(__dirname, 'data', fileName);
  const raw = readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw) as T;
};

const seedReimputations = async (): Promise<number> => {
  const rows = loadJson<ReimputationRaw[]>('reimputations.json');
  if (rows.length === 0) return 0;

  const ops = rows.map((row) => ({
    updateOne: {
      filter: {
        'desde.nombreCuenta': row.desde.nombreCuenta,
        'desde.nombreSubcuenta': row.desde.nombreSubcuenta,
      },
      update: {
        $set: {
          desde: row.desde,
          hacia: {
            numeroCuenta: String(row.hacia.numeroCuenta),
            nombreCuenta: row.hacia.nombreCuenta,
          },
        },
      },
      upsert: true,
    },
  }));

  const result = await ReimputationRuleModel.bulkWrite(ops, { ordered: false });
  console.log(
    `  reimputation_rules: ${rows.length} input | upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
  );
  return rows.length;
};

const seedAnulaciones = async (): Promise<number> => {
  const rows = loadJson<AnulacionRaw[]>('anulaciones.json');
  if (rows.length === 0) return 0;

  const ops = rows.map((row) => ({
    updateOne: {
      filter: {
        'cuenta.nombreCuenta': row.cuenta.nombreCuenta,
        'subcuenta.nombreSubcuenta': row.subcuenta.nombreSubcuenta,
      },
      update: { $set: { cuenta: row.cuenta, subcuenta: row.subcuenta } },
      upsert: true,
    },
  }));

  const result = await AnulacionRuleModel.bulkWrite(ops, { ordered: false });
  console.log(
    `  anulacion_rules:    ${rows.length} input | upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
  );
  return rows.length;
};

const seedSubrubros = async (): Promise<number> => {
  const rows = loadJson<SubrubroRaw[]>('subrubros.json');
  if (rows.length === 0) return 0;

  const ops = rows.map((row) => ({
    updateOne: {
      filter: { nombreCuentaReimputada: row.nombreCuentaReimputada },
      update: { $set: { nombreSubrubro: row.nombreSubrubro } },
      upsert: true,
    },
  }));

  const result = await SubrubroMapModel.bulkWrite(ops, { ordered: false });
  console.log(
    `  subrubro_map:       ${rows.length} input | upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
  );
  return rows.length;
};

const run = async (): Promise<void> => {
  console.log('[seed:rules] Starting...');
  await connectDB();

  console.log('[seed:rules] Upserting rules:');
  const r = await seedReimputations();
  const a = await seedAnulaciones();
  const s = await seedSubrubros();

  // Verify counts
  const [reimpCount, anulCount, subCount] = await Promise.all([
    ReimputationRuleModel.countDocuments(),
    AnulacionRuleModel.countDocuments(),
    SubrubroMapModel.countDocuments(),
  ]);

  console.log('[seed:rules] Counts in DB:');
  console.log(`  reimputation_rules: ${reimpCount} (json had ${r})`);
  console.log(`  anulacion_rules:    ${anulCount} (json had ${a})`);
  console.log(`  subrubro_map:       ${subCount} (json had ${s})`);

  await mongoose.disconnect();
  console.log('[seed:rules] Done.');
};

run().catch((err) => {
  console.error('[seed:rules] Failed:', err);
  process.exit(1);
});
