import { createHash } from 'crypto';
import { Types } from 'mongoose';

import {
  AnulacionRule,
  IngestionBatch,
  IngestionBatchModel,
  InventoryItemModel,
  Movement,
  MovementModel,
  ReimputationRule,
  SubrubroMap,
  AnulacionRuleModel,
  ReimputationRuleModel,
  SubrubroMapModel,
} from '../../models';
import { Empresa, classifyRubro } from '../../types/empresa';
import { calculateCMV, enrichInventoryItem } from '../cmv/CMVCalculator';
import { CMVPseudoMovement, CMVWarning } from '../cmv/types';
import { AnulacionTagger } from '../enrichment/AnulacionTagger';
import { Reimputator } from '../enrichment/Reimputator';
import { SubrubroEnricher } from '../enrichment/SubrubroEnricher';
import { enrichMovements } from '../enrichment/pipeline';
import { EnrichedMovement, EnrichmentWarning } from '../enrichment/types';
import { parseInventory } from '../inventory/InventoryParser';
import { InventoryParseWarning, InventoryParsedRow } from '../inventory/types';
import { parseLedger } from '../parser/LedgerParser';
import { ParseWarning } from '../parser/types';

/**
 * Empresa to which CMV pseudo-movements get imputed. The inventory file is
 * consolidated (single file for all 4 entities) and Sebastián confirmed the
 * other three are "medio pantalla", so attributing CMV/financial-result
 * adjustments to SUPERBOL is the pragmatic choice.
 */
const CMV_EMPRESA: Empresa = 'SUPERBOL';

export type LedgerInput = {
  empresa: Empresa;
  archivo: string;
  buffer: Buffer;
};

export type InventoryInput = {
  archivo: string;
  buffer: Buffer;
};

export type IngestionInput = {
  /** 0..4 ledgers (each empresa unique). At least one ledger or inventory must be present. */
  ledgers: LedgerInput[];
  /** Optional consolidated inventory file. */
  inventory?: InventoryInput;
  /**
   * Required when no ledgers are uploaded (inventory-only). When ledgers are
   * present, the parser-inferred period takes precedence; if `periodo` is
   * also passed and disagrees, request is rejected.
   */
  periodo?: string;
  /**
   * If true, conflicting batches (same kind+empresa for the period) are
   * deleted before write. Only conflicts in THIS request's scope are touched
   * — other empresas in the period are untouched.
   */
  force?: boolean;
};

// ── Outcome types ────────────────────────────────────────────────────────────

export type LedgerOutcome =
  | {
      kind: 'ledger';
      empresa: Empresa;
      status: 'success';
      batchId: string;
      rowsProcessed: number;
      warnings: { parser: ParseWarning[]; enrichment: EnrichmentWarning[] };
    }
  | {
      kind: 'ledger';
      empresa: Empresa;
      status: 'failed';
      error: string;
      warnings: { parser: ParseWarning[]; enrichment: EnrichmentWarning[] };
    };

export type InventoryOutcome =
  | {
      kind: 'inventory';
      status: 'success';
      batchId: string;
      itemsProcessed: number;
      warnings: { inventory: InventoryParseWarning[] };
    }
  | {
      kind: 'inventory';
      status: 'failed';
      error: string;
      warnings: { inventory: InventoryParseWarning[] };
    };

export type CMVRecomputeOutcome = {
  inventoryBatchId: string;
  totals: {
    stockInicial: number;
    compras: number;
    stockFinal: number;
    cmvBruto: number;
    costoFinanciero: number;
    cmvAjustado: number;
  };
  pseudoMovementsInserted: number;
  warnings: CMVWarning[];
};

export type ConflictItem = {
  kind: 'ledger' | 'inventory';
  empresa: Empresa | null;
  existingBatchId: string;
  existingCreatedAt: Date;
  rowsProcessed: number;
};

export type ConflictError = Error & {
  status: 409;
  conflicts: ConflictItem[];
  periodo: string;
};

export type IngestionResult = {
  periodo: string;
  ledgers: LedgerOutcome[];
  inventory: InventoryOutcome | null;
  cmv: CMVRecomputeOutcome | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

const httpError = (status: number, message: string): Error & { status: number } => {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
};

const PERIODO_RE = /^\d{2}\/\d{4}$/;

const validateInput = (input: IngestionInput): void => {
  if (input.ledgers.length === 0 && !input.inventory) {
    throw httpError(400, 'Debe enviarse al menos un mayor o un inventario');
  }
  const empresas = new Set<string>();
  for (const l of input.ledgers) {
    if (empresas.has(l.empresa)) {
      throw httpError(400, `Empresa duplicada en mayores: ${l.empresa}`);
    }
    empresas.add(l.empresa);
  }
  if (input.periodo && !PERIODO_RE.test(input.periodo)) {
    throw httpError(400, `Periodo inválido: ${input.periodo} (formato esperado MM/YYYY)`);
  }
};

const enrichedToMovementDoc = (
  m: EnrichedMovement,
  ctx: { empresa: Empresa; periodo: string; archivo: string; batchId: Types.ObjectId },
): Omit<Movement, '_id' | 'createdAt' | 'updatedAt'> => ({
  empresa: ctx.empresa,
  periodo: ctx.periodo,
  fechaISO: m.fechaISO,
  archivo: ctx.archivo,
  ingestionBatchId: ctx.batchId,
  sourceType: 'ledger',
  asiento: m.asiento,
  numeroCuenta: m.numeroCuenta,
  nombreCuenta: m.nombreCuenta,
  numeroSubcuenta: m.numeroSubcuenta,
  nombreSubcuenta: m.nombreSubcuenta,
  rubro: m.rubro,
  detalle: m.detalle,
  debe: m.debe,
  haber: m.haber,
  numeroCuentaReimputada: m.numeroCuentaReimputada,
  nombreCuentaReimputada: m.nombreCuentaReimputada,
  rubroReimputada: m.rubroReimputada,
  subrubro: m.subrubro,
  anulacion: m.anulacion,
});

const pseudoMovToMovementDoc = (
  pm: CMVPseudoMovement,
  ctx: { empresa: Empresa; periodo: string; archivo: string; batchId: Types.ObjectId },
): Omit<Movement, '_id' | 'createdAt' | 'updatedAt'> => ({
  empresa: ctx.empresa,
  periodo: ctx.periodo,
  fechaISO: pm.fechaISO,
  archivo: ctx.archivo,
  ingestionBatchId: ctx.batchId,
  sourceType: 'cmv-calc',
  asiento: pm.asiento,
  numeroCuenta: pm.numeroCuenta,
  nombreCuenta: pm.nombreCuenta,
  numeroSubcuenta: pm.numeroSubcuenta,
  nombreSubcuenta: pm.nombreSubcuenta,
  rubro: classifyRubro(pm.numeroCuenta),
  detalle: pm.detalle,
  debe: pm.debe,
  haber: pm.haber,
  numeroCuentaReimputada: pm.numeroCuentaReimputada,
  nombreCuentaReimputada: pm.nombreCuentaReimputada,
  rubroReimputada: classifyRubro(pm.numeroCuentaReimputada),
  subrubro: pm.subrubro,
  anulacion: pm.anulacion,
});

// ── CMV recompute ────────────────────────────────────────────────────────────

/**
 * Recompute CMV for a period from the current DB state.
 *
 * - No-op when no successful inventory batch exists for the period.
 * - Reads InventoryItem rows + all ledger movs (across batches) for the period.
 * - Wipes prior pseudo-movements (sourceType='cmv-calc') for the period and
 *   reinserts the freshly-calculated set, tagged to the inventory batch.
 * - Updates the inventory batch's stats.
 *
 * Triggered after every successful ingest action (ledger upload, inventory
 * upload, or replacement). Idempotent — safe to call multiple times.
 */
export const recomputeCMVForPeriod = async (
  periodo: string,
): Promise<CMVRecomputeOutcome | null> => {
  const invBatch = await IngestionBatchModel.findOne({
    periodo,
    kind: 'inventory',
    status: 'success',
  }).lean<IngestionBatch | null>();
  if (!invBatch) return null;

  const [items, movs] = await Promise.all([
    InventoryItemModel.find({ ingestionBatchId: invBatch._id }).lean(),
    MovementModel.find({ periodo, sourceType: 'ledger' }).lean(),
  ]);

  // Reconstruct parsed rows from stored enriched items.
  const parsedRows: InventoryParsedRow[] = items.map((it) => ({
    categoria: it.categoria,
    unidMesAnterior: it.unidMesAnterior,
    precioMesAnterior: it.precioMesAnterior,
    valorMesAnterior: it.valorMesAnterior,
    unidMesEnCurso: it.unidMesEnCurso,
    precioMesEnCurso: it.precioMesEnCurso,
    valorMesEnCurso: it.valorMesEnCurso,
    mermaPct: it.mermaPct ?? null,
  }));

  // The CMV calc only reads numeroCuenta, debe, haber from movements — the
  // stored Movement docs already have all the fields it needs.
  const enrichedMovs = movs as unknown as EnrichedMovement[];

  const cmv = calculateCMV({
    periodo,
    inventoryItems: parsedRows,
    movements: enrichedMovs,
  });

  await MovementModel.deleteMany({ periodo, sourceType: 'cmv-calc' });
  if (cmv.pseudoMovements.length > 0) {
    const docs = cmv.pseudoMovements.map((pm) =>
      pseudoMovToMovementDoc(pm, {
        empresa: CMV_EMPRESA,
        periodo,
        archivo: invBatch.file.name,
        batchId: invBatch._id,
      }),
    );
    await MovementModel.insertMany(docs, { ordered: false });
  }

  await IngestionBatchModel.updateOne(
    { _id: invBatch._id },
    {
      $set: {
        'stats.inventoryItems': items.length,
        'stats.movementsInserted': cmv.pseudoMovements.length,
        'stats.stockInicial': cmv.totals.stockInicial,
        'stats.compras': cmv.totals.compras,
        'stats.stockFinal': cmv.totals.stockFinal,
        'stats.cmvBruto': cmv.totals.cmvBruto,
        'stats.costoFinanciero': cmv.totals.costoFinanciero,
        'stats.cmvAjustado': cmv.totals.cmvAjustado,
      },
    },
  );

  return {
    inventoryBatchId: invBatch._id.toString(),
    totals: cmv.totals,
    pseudoMovementsInserted: cmv.pseudoMovements.length,
    warnings: cmv.warnings,
  };
};

// ── Per-(empresa, kind) ingestion ────────────────────────────────────────────

type ParsedLedger = {
  input: LedgerInput;
  enriched: EnrichedMovement[];
  parserWarnings: ParseWarning[];
  enrichmentWarnings: EnrichmentWarning[];
  /** null when the file has no movs (sentinel '00/0000') or parse blew up. */
  periodo: string | null;
  parseError?: string;
};

/**
 * Pure orchestrator that ingests one upload (1+ ledgers + 0..1 inventory).
 *
 * Flow:
 *  1. Validate input shape.
 *  2. Load enrichment rules.
 *  3. Parse + enrich each ledger in-memory; capture per-empresa errors
 *     without aborting the rest.
 *  4. Resolve periodo (parser-inferred wins; falls back to input.periodo
 *     for inventory-only uploads).
 *  5. DB conflict check: any of (periodo, kind='ledger', empresa) or
 *     (periodo, kind='inventory') already at status='success'?
 *     - If yes and !force: throw ConflictError (409).
 *     - If yes and force: cascade-delete only the conflicting batches.
 *  6. For each ledger: create batch (status='processing'), insert movs,
 *     mark success. On error: mark batch failed, continue with the others.
 *  7. If inventory provided: same flow.
 *  8. Recompute CMV for the period (no-op if no inventory batch exists).
 *  9. Return per-batch outcomes + CMV result.
 *
 * Each ledger / inventory is an independent unit — a SUSTEN parse failure
 * does not roll back a successful SUPERBOL upload.
 */
export const ingest = async (input: IngestionInput): Promise<IngestionResult> => {
  validateInput(input);

  // 2. Load rules
  const [reimputationRules, anulacionRules, subrubroMaps] = await Promise.all([
    ReimputationRuleModel.find().lean<ReimputationRule[]>(),
    AnulacionRuleModel.find().lean<AnulacionRule[]>(),
    SubrubroMapModel.find().lean<SubrubroMap[]>(),
  ]);
  const reimputator = new Reimputator(reimputationRules);
  const anulacionTagger = new AnulacionTagger(anulacionRules);
  const subrubroEnricher = new SubrubroEnricher(subrubroMaps);

  // 3. Parse + enrich ledgers (in-memory)
  const parsed: ParsedLedger[] = input.ledgers.map((l): ParsedLedger => {
    try {
      const r = parseLedger(l.buffer, { empresa: l.empresa, archivo: l.archivo });
      const enriched = enrichMovements(r.movements, {
        reimputator,
        anulacionTagger,
        subrubroEnricher,
      });
      return {
        input: l,
        enriched: enriched.movements,
        parserWarnings: r.warnings,
        enrichmentWarnings: enriched.warnings,
        periodo: r.periodo === '00/0000' ? null : r.periodo,
      };
    } catch (err) {
      return {
        input: l,
        enriched: [],
        parserWarnings: [],
        enrichmentWarnings: [],
        periodo: null,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // 4. Resolve periodo
  const distinctPeriodos = new Set(
    parsed.filter((p) => p.periodo).map((p) => p.periodo as string),
  );
  if (distinctPeriodos.size > 1) {
    throw httpError(
      400,
      `Los mayores tienen períodos distintos: ${[...distinctPeriodos].join(', ')}`,
    );
  }
  const inferredPeriodo = [...distinctPeriodos][0];
  if (inferredPeriodo && input.periodo && inferredPeriodo !== input.periodo) {
    throw httpError(
      400,
      `Periodo inferido (${inferredPeriodo}) no coincide con el solicitado (${input.periodo})`,
    );
  }
  const periodo = inferredPeriodo ?? input.periodo;
  if (!periodo) {
    throw httpError(
      400,
      'No se pudo inferir período: los mayores no tienen movimientos y no se proporcionó período',
    );
  }

  // 5. Conflict check
  const requestedEmpresas = parsed
    .filter((p) => !p.parseError)
    .map((p) => p.input.empresa);

  const [existingLedgers, existingInv] = await Promise.all([
    requestedEmpresas.length > 0
      ? IngestionBatchModel.find({
          periodo,
          kind: 'ledger',
          status: 'success',
          empresa: { $in: requestedEmpresas },
        }).lean<IngestionBatch[]>()
      : Promise.resolve([]),
    input.inventory
      ? IngestionBatchModel.findOne({
          periodo,
          kind: 'inventory',
          status: 'success',
        }).lean<IngestionBatch | null>()
      : Promise.resolve(null),
  ]);

  const conflicts: ConflictItem[] = [];
  for (const e of existingLedgers) {
    conflicts.push({
      kind: 'ledger',
      empresa: e.empresa,
      existingBatchId: e._id.toString(),
      existingCreatedAt: e.createdAt!,
      rowsProcessed: e.file.rowsProcessed,
    });
  }
  if (existingInv) {
    conflicts.push({
      kind: 'inventory',
      empresa: null,
      existingBatchId: existingInv._id.toString(),
      existingCreatedAt: existingInv.createdAt!,
      rowsProcessed: existingInv.file.rowsProcessed,
    });
  }

  if (conflicts.length > 0 && !input.force) {
    const labels = conflicts
      .map((c) => (c.kind === 'inventory' ? 'inventario' : c.empresa))
      .join(', ');
    const err = httpError(
      409,
      `Ya existen datos para ${periodo}: ${labels}. Usar force=true para reemplazar.`,
    ) as ConflictError;
    err.conflicts = conflicts;
    err.periodo = periodo;
    throw err;
  }

  // Force path: cascade-delete only the conflicting batches.
  if (input.force && conflicts.length > 0) {
    const batchIds = conflicts.map((c) => new Types.ObjectId(c.existingBatchId));
    await Promise.all([
      MovementModel.deleteMany({ ingestionBatchId: { $in: batchIds } }),
      InventoryItemModel.deleteMany({ ingestionBatchId: { $in: batchIds } }),
      IngestionBatchModel.deleteMany({ _id: { $in: batchIds } }),
    ]);
  }

  // 6. Per-ledger ingestion
  const ledgerOutcomes: LedgerOutcome[] = [];
  for (const p of parsed) {
    if (p.parseError) {
      ledgerOutcomes.push({
        kind: 'ledger',
        empresa: p.input.empresa,
        status: 'failed',
        error: p.parseError,
        warnings: { parser: p.parserWarnings, enrichment: p.enrichmentWarnings },
      });
      continue;
    }
    let batchId: Types.ObjectId | null = null;
    try {
      const batch = await IngestionBatchModel.create({
        periodo,
        kind: 'ledger',
        empresa: p.input.empresa,
        file: {
          name: p.input.archivo,
          hash: sha256(p.input.buffer),
          rowsProcessed: p.enriched.length,
        },
        status: 'processing',
      });
      batchId = batch._id;

      const movDocs = p.enriched.map((m) =>
        enrichedToMovementDoc(m, {
          empresa: p.input.empresa,
          periodo,
          archivo: p.input.archivo,
          batchId: batchId!,
        }),
      );
      if (movDocs.length > 0) {
        await MovementModel.insertMany(movDocs, { ordered: false });
      }
      await IngestionBatchModel.updateOne(
        { _id: batchId },
        { $set: { status: 'success', 'stats.movementsInserted': movDocs.length } },
      );

      ledgerOutcomes.push({
        kind: 'ledger',
        empresa: p.input.empresa,
        status: 'success',
        batchId: batchId.toString(),
        rowsProcessed: movDocs.length,
        warnings: { parser: p.parserWarnings, enrichment: p.enrichmentWarnings },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (batchId) {
        await IngestionBatchModel.updateOne(
          { _id: batchId },
          { $set: { status: 'failed' }, $push: { errors: msg } },
        );
      }
      ledgerOutcomes.push({
        kind: 'ledger',
        empresa: p.input.empresa,
        status: 'failed',
        error: msg,
        warnings: { parser: p.parserWarnings, enrichment: p.enrichmentWarnings },
      });
    }
  }

  // 7. Inventory ingestion
  let inventoryOutcome: InventoryOutcome | null = null;
  if (input.inventory) {
    let inventoryWarnings: InventoryParseWarning[] = [];
    let batchId: Types.ObjectId | null = null;
    try {
      const invParsed = parseInventory(input.inventory.buffer);
      inventoryWarnings = invParsed.warnings;
      if (invParsed.rows.length === 0) {
        const reasons = invParsed.warnings
          .map((w) => `[${w.code}] ${w.message}`)
          .join('; ');
        throw new Error(
          `El inventario no produjo ítems parseables. ${reasons || ''}`.trim(),
        );
      }
      const batch = await IngestionBatchModel.create({
        periodo,
        kind: 'inventory',
        empresa: null,
        file: {
          name: input.inventory.archivo,
          hash: sha256(input.inventory.buffer),
          rowsProcessed: invParsed.stats.itemsParsed,
        },
        status: 'processing',
      });
      batchId = batch._id;

      const itemDocs = invParsed.rows.map((row) => {
        const enriched = enrichInventoryItem(row);
        return {
          periodo,
          ingestionBatchId: batchId!,
          ...enriched,
        };
      });
      await InventoryItemModel.insertMany(itemDocs, { ordered: false });

      await IngestionBatchModel.updateOne(
        { _id: batchId },
        { $set: { status: 'success', 'stats.inventoryItems': itemDocs.length } },
      );

      inventoryOutcome = {
        kind: 'inventory',
        status: 'success',
        batchId: batchId.toString(),
        itemsProcessed: itemDocs.length,
        warnings: { inventory: inventoryWarnings },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (batchId) {
        await IngestionBatchModel.updateOne(
          { _id: batchId },
          { $set: { status: 'failed' }, $push: { errors: msg } },
        );
      }
      inventoryOutcome = {
        kind: 'inventory',
        status: 'failed',
        error: msg,
        warnings: { inventory: inventoryWarnings },
      };
    }
  }

  // 8. CMV recompute (no-op if no inventory batch exists for the period)
  const cmv = await recomputeCMVForPeriod(periodo);

  return {
    periodo,
    ledgers: ledgerOutcomes,
    inventory: inventoryOutcome,
    cmv,
  };
};

export { sha256 };
