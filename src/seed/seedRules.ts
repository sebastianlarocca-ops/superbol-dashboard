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
 * Reads JSON files under src/seed/data/ and SYNCS them to MongoDB:
 *   1. Upserts every JSON row (by natural key)
 *   2. Prunes DB rows whose natural key is NOT in the JSON (so if we
 *      remove/rename a rule in the JSON, the DB follows)
 *
 * Natural keys:
 *   - reimputation_rules: { desde.nombreCuenta, desde.nombreSubcuenta }
 *   - anulacion_rules:    { cuenta.nombreCuenta, subcuenta.nombreSubcuenta }
 *   - subrubro_map:       { nombreCuentaReimputada }
 *
 * Safe to run multiple times. Treat JSON as source of truth.
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

  // 1. Upsert
  if (rows.length > 0) {
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
      `  reimputation_rules: upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
    );
  }

  // 2. Prune: delete anything whose natural key isn't in the JSON
  const keepFilters = rows.map((r) => ({
    'desde.nombreCuenta': r.desde.nombreCuenta,
    'desde.nombreSubcuenta': r.desde.nombreSubcuenta,
  }));
  const pruneResult = await ReimputationRuleModel.deleteMany(
    rows.length > 0 ? { $nor: keepFilters } : {},
  );
  if (pruneResult.deletedCount > 0) {
    console.log(`  reimputation_rules: pruned=${pruneResult.deletedCount} (not in JSON)`);
  }

  return rows.length;
};

const seedAnulaciones = async (): Promise<number> => {
  const rows = loadJson<AnulacionRaw[]>('anulaciones.json');

  if (rows.length > 0) {
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
      `  anulacion_rules:    upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
    );
  }

  const keepFilters = rows.map((r) => ({
    'cuenta.nombreCuenta': r.cuenta.nombreCuenta,
    'subcuenta.nombreSubcuenta': r.subcuenta.nombreSubcuenta,
  }));
  const pruneResult = await AnulacionRuleModel.deleteMany(
    rows.length > 0 ? { $nor: keepFilters } : {},
  );
  if (pruneResult.deletedCount > 0) {
    console.log(`  anulacion_rules:    pruned=${pruneResult.deletedCount} (not in JSON)`);
  }

  return rows.length;
};

const seedSubrubros = async (): Promise<number> => {
  const rows = loadJson<SubrubroRaw[]>('subrubros.json');

  if (rows.length > 0) {
    const ops = rows.map((row) => ({
      updateOne: {
        filter: { nombreCuentaReimputada: row.nombreCuentaReimputada },
        update: { $set: { nombreSubrubro: row.nombreSubrubro } },
        upsert: true,
      },
    }));
    const result = await SubrubroMapModel.bulkWrite(ops, { ordered: false });
    console.log(
      `  subrubro_map:       upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
    );
  }

  const keepKeys = rows.map((r) => r.nombreCuentaReimputada);
  const pruneResult = await SubrubroMapModel.deleteMany(
    rows.length > 0
      ? { nombreCuentaReimputada: { $nin: keepKeys } }
      : {},
  );
  if (pruneResult.deletedCount > 0) {
    console.log(`  subrubro_map:       pruned=${pruneResult.deletedCount} (not in JSON)`);
  }

  return rows.length;
};

const run = async (): Promise<void> => {
  console.log('[seed:rules] Starting...');
  await connectDB();

  console.log('[seed:rules] Syncing JSON → DB:');
  const r = await seedReimputations();
  const a = await seedAnulaciones();
  const s = await seedSubrubros();

  const [reimpCount, anulCount, subCount] = await Promise.all([
    ReimputationRuleModel.countDocuments(),
    AnulacionRuleModel.countDocuments(),
    SubrubroMapModel.countDocuments(),
  ]);

  console.log('[seed:rules] Final counts in DB:');
  console.log(`  reimputation_rules: ${reimpCount} (json had ${r})`);
  console.log(`  anulacion_rules:    ${anulCount} (json had ${a})`);
  console.log(`  subrubro_map:       ${subCount} (json had ${s})`);

  if (reimpCount !== r || anulCount !== a || subCount !== s) {
    console.error('[seed:rules] ⚠️  DB counts do not match JSON counts!');
    process.exitCode = 1;
  }

  await mongoose.disconnect();
  console.log('[seed:rules] Done.');
};

run().catch((err) => {
  console.error('[seed:rules] Failed:', err);
  process.exit(1);
});
