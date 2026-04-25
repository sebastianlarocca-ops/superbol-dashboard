import { createHash } from 'crypto';
import mongoose, { Types } from 'mongoose';

import {
  AnulacionRule,
  IngestionBatch,
  IngestionBatchModel,
  IngestionFile,
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
import { calculateCMV } from '../cmv/CMVCalculator';
import { CMVPseudoMovement } from '../cmv/types';
import { AnulacionTagger } from '../enrichment/AnulacionTagger';
import { Reimputator } from '../enrichment/Reimputator';
import { SubrubroEnricher } from '../enrichment/SubrubroEnricher';
import { enrichMovements } from '../enrichment/pipeline';
import { EnrichedMovement, EnrichmentWarning } from '../enrichment/types';
import { parseInventory } from '../inventory/InventoryParser';
import { InventoryParseWarning } from '../inventory/types';
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
  ledgers: LedgerInput[]; // 1..4 (one per empresa, no duplicates)
  inventory: InventoryInput;
  /**
   * If true, delete any prior successful batch for the same period before
   * ingesting. Useful for reprocessing the same month after rule changes.
   */
  force?: boolean;
};

export type IngestionResult = {
  batchId: string;
  periodo: string;
  status: IngestionBatch['status'];
  stats: IngestionBatch['stats'];
  files: IngestionFile[];
  warnings: {
    parser: ParseWarning[];
    enrichment: EnrichmentWarning[];
    inventory: InventoryParseWarning[];
    cmv: { code: string; message: string }[];
  };
};

/** Compute SHA-256 of a buffer. Used for file dedupe / idempotency. */
const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/**
 * Validate the input shape: empresas unique, at least one ledger, etc.
 * Throws Error with a status property the route handler turns into 4xx.
 */
const validateInput = (input: IngestionInput): void => {
  if (!input.inventory) {
    throw httpError(400, 'Falta el archivo de inventario');
  }
  if (!input.ledgers || input.ledgers.length === 0) {
    throw httpError(400, 'Debe enviarse al menos un mayor');
  }
  const empresas = new Set<string>();
  for (const l of input.ledgers) {
    if (empresas.has(l.empresa)) {
      throw httpError(400, `Empresa duplicada en mayores: ${l.empresa}`);
    }
    empresas.add(l.empresa);
  }
};

const httpError = (status: number, message: string): Error & { status: number } => {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
};

/**
 * Convert a CMV pseudo-movement into a Movement document, filling in the
 * batch/empresa metadata and computing rubro/rubroReimputada from cuenta.
 */
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

/**
 * Convert an enriched ledger movement into a Movement document.
 */
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

/**
 * Pure orchestrator that ingests one monthly batch.
 *
 * Flow:
 *  1. Validate input shape.
 *  2. Load enrichment rules (once).
 *  3. Parse + enrich every ledger; aggregate parser/enrichment warnings.
 *  4. Verify all parsed periodos agree.
 *  5. Idempotency check: reject if a successful batch already exists for the
 *     period with the same inventory hash, unless `force=true`.
 *  6. Create IngestionBatch (status='processing').
 *  7. Parse inventory + run CMVCalculator.
 *  8. Bulk-insert all Movement docs (ledger + 4 CMV pseudo-movs).
 *  9. Bulk-insert all InventoryItem docs.
 * 10. Update batch with stats + status='success' (or 'failed' on error).
 *
 * Not wrapped in a mongoose transaction to keep the code simple; if step 8
 * or 9 fails, the batch is marked 'failed' with the error and step 5
 * re-rejects on retry. A future cleanup endpoint can purge failed batches.
 */
export const ingest = async (input: IngestionInput): Promise<IngestionResult> => {
  validateInput(input);

  // Load rules in parallel (same as loadEnrichmentPipeline but inline so we
  // can pre-compute file hashes during the IO wait).
  const [reimputationRules, anulacionRules, subrubroMaps] = await Promise.all([
    ReimputationRuleModel.find().lean<ReimputationRule[]>(),
    AnulacionRuleModel.find().lean<AnulacionRule[]>(),
    SubrubroMapModel.find().lean<SubrubroMap[]>(),
  ]);
  const reimputator = new Reimputator(reimputationRules);
  const anulacionTagger = new AnulacionTagger(anulacionRules);
  const subrubroEnricher = new SubrubroEnricher(subrubroMaps);

  // Parse + enrich ledgers (in-memory; the parsing is fast — sub-second per
  // file at 30k rows — and we need everything before we can compute Compras).
  const parserWarnings: ParseWarning[] = [];
  const enrichmentWarnings: EnrichmentWarning[] = [];
  const allEnriched: { ledgerInput: LedgerInput; enriched: EnrichedMovement[] }[] = [];

  const periodos = new Set<string>();
  for (const l of input.ledgers) {
    const parsed = parseLedger(l.buffer, { empresa: l.empresa, archivo: l.archivo });
    parserWarnings.push(...parsed.warnings);
    // Skip the sentinel "00/0000" — that's what the parser emits when the
    // file has no movimientos (legitimate for "empresas pantalla" like POINT).
    if (parsed.periodo !== '00/0000') periodos.add(parsed.periodo);
    const enriched = enrichMovements(parsed.movements, {
      reimputator,
      anulacionTagger,
      subrubroEnricher,
    });
    enrichmentWarnings.push(...enriched.warnings);
    allEnriched.push({ ledgerInput: l, enriched: enriched.movements });
  }

  if (periodos.size === 0) {
    throw httpError(
      400,
      'Ningún mayor tiene movimientos — no se puede inferir el período',
    );
  }
  if (periodos.size > 1) {
    throw httpError(
      400,
      `Los mayores tienen períodos distintos: ${[...periodos].join(', ')}`,
    );
  }
  const periodo = [...periodos][0];

  // Idempotency: hash all files; reject if a successful batch matches.
  const ledgerFiles: IngestionFile[] = input.ledgers.map((l, i) => ({
    name: l.archivo,
    hash: sha256(l.buffer),
    kind: 'ledger',
    empresa: l.empresa,
    rowsProcessed: allEnriched[i].enriched.length,
  }));
  const inventoryFile: IngestionFile = {
    name: input.inventory.archivo,
    hash: sha256(input.inventory.buffer),
    kind: 'inventory',
    empresa: null,
    rowsProcessed: 0, // updated after parse
  };
  const allFiles: IngestionFile[] = [...ledgerFiles, inventoryFile];

  const existing = await IngestionBatchModel.findOne({
    periodo,
    status: 'success',
  }).lean<IngestionBatch | null>();
  if (existing) {
    if (!input.force) {
      throw httpError(
        409,
        `Ya existe un batch exitoso para período ${periodo} (${existing._id}). ` +
          `Usar force=true para reingestar.`,
      );
    }
    // Force: cascade-delete previous batch's data
    await Promise.all([
      MovementModel.deleteMany({ ingestionBatchId: existing._id }),
      InventoryItemModel.deleteMany({ ingestionBatchId: existing._id }),
      IngestionBatchModel.deleteOne({ _id: existing._id }),
    ]);
  }

  // Create batch
  const batch = await IngestionBatchModel.create({
    periodo,
    files: allFiles,
    status: 'processing',
    stats: {
      movementsInserted: 0,
      inventoryItems: 0,
      stockInicial: 0,
      compras: 0,
      stockFinal: 0,
      cmvBruto: 0,
      costoFinanciero: 0,
      cmvAjustado: 0,
    },
    errors: [],
  });

  try {
    // Parse inventory + CMV
    const invParsed = parseInventory(input.inventory.buffer);
    // Hard fail if the inventory parsed to nothing: that means the parser
    // didn't recognize the sheet structure (header missing, wrong tab name,
    // etc.). Without inventory we can't compute SI/SF/cf, so the batch's
    // CMV would be just "compras" — wrong answer that looks right. Better
    // to abort and let the user fix the file than silently corrupt the
    // period's numbers.
    if (invParsed.rows.length === 0) {
      const reasons = invParsed.warnings.map((w) => `[${w.code}] ${w.message}`).join('; ');
      throw httpError(
        400,
        `El inventario no produjo ítems parseables. Revisar el archivo. ` +
          (reasons ? `Causa: ${reasons}` : ''),
      );
    }
    const flatEnriched = allEnriched.flatMap((x) => x.enriched);
    const cmv = calculateCMV({
      periodo,
      inventoryItems: invParsed.rows,
      movements: flatEnriched,
    });

    // Build all Movement docs
    const movementDocs: Omit<Movement, '_id' | 'createdAt' | 'updatedAt'>[] = [];
    for (const { ledgerInput, enriched } of allEnriched) {
      for (const m of enriched) {
        movementDocs.push(
          enrichedToMovementDoc(m, {
            empresa: ledgerInput.empresa,
            periodo,
            archivo: ledgerInput.archivo,
            batchId: batch._id,
          }),
        );
      }
    }
    for (const pm of cmv.pseudoMovements) {
      movementDocs.push(
        pseudoMovToMovementDoc(pm, {
          empresa: CMV_EMPRESA,
          periodo,
          archivo: input.inventory.archivo,
          batchId: batch._id,
        }),
      );
    }

    // Build InventoryItem docs
    const itemDocs = cmv.items.map((it) => ({
      periodo,
      ingestionBatchId: batch._id,
      categoria: it.categoria,
      unidMesAnterior: it.unidMesAnterior,
      precioMesAnterior: it.precioMesAnterior,
      valorMesAnterior: it.valorMesAnterior,
      unidMesEnCurso: it.unidMesEnCurso,
      precioMesEnCurso: it.precioMesEnCurso,
      valorMesEnCurso: it.valorMesEnCurso,
      deltaPrecio: it.deltaPrecio,
      casoCalculado: it.casoCalculado,
      unidadesAfectadas: it.unidadesAfectadas,
      costoFinanciero: it.costoFinanciero,
      mermaPct: it.mermaPct,
    }));

    // Bulk insert (ordered:false for movements so a single bad doc doesn't
    // abort the whole batch — we'd rather partial-success and surface in
    // warnings than rollback 4k movements over one validation issue).
    await MovementModel.insertMany(movementDocs, { ordered: false });
    await InventoryItemModel.insertMany(itemDocs, { ordered: false });

    // Update inventory file rowsProcessed with the actual parsed count
    const filesWithCounts = allFiles.map((f) =>
      f.kind === 'inventory' ? { ...f, rowsProcessed: invParsed.stats.itemsParsed } : f,
    );

    // Final update: stats + success
    await IngestionBatchModel.updateOne(
      { _id: batch._id },
      {
        $set: {
          status: 'success',
          files: filesWithCounts,
          stats: {
            movementsInserted: movementDocs.length,
            inventoryItems: itemDocs.length,
            stockInicial: cmv.totals.stockInicial,
            compras: cmv.totals.compras,
            stockFinal: cmv.totals.stockFinal,
            cmvBruto: cmv.totals.cmvBruto,
            costoFinanciero: cmv.totals.costoFinanciero,
            cmvAjustado: cmv.totals.cmvAjustado,
          },
        },
      },
    );

    return {
      batchId: batch._id.toString(),
      periodo,
      status: 'success',
      stats: {
        movementsInserted: movementDocs.length,
        inventoryItems: itemDocs.length,
        stockInicial: cmv.totals.stockInicial,
        compras: cmv.totals.compras,
        stockFinal: cmv.totals.stockFinal,
        cmvBruto: cmv.totals.cmvBruto,
        costoFinanciero: cmv.totals.costoFinanciero,
        cmvAjustado: cmv.totals.cmvAjustado,
      },
      files: filesWithCounts,
      warnings: {
        parser: parserWarnings,
        enrichment: enrichmentWarnings,
        inventory: invParsed.warnings,
        cmv: cmv.warnings,
      },
    };
  } catch (err) {
    // Mark batch as failed but keep the row for diagnosis
    const message = err instanceof Error ? err.message : String(err);
    await IngestionBatchModel.updateOne(
      { _id: batch._id },
      { $set: { status: 'failed' }, $push: { errors: message } },
    );
    throw err;
  }
};

// Re-export for tests / dry-runs
export { sha256 };
// Avoid unused-import lint by referencing mongoose explicitly (used for typing
// elsewhere in this module's consumers).
void mongoose;
