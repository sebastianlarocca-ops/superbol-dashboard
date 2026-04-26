import { Schema, model, Types } from 'mongoose';
import { EMPRESAS, Empresa } from '../types/empresa';

/**
 * Tracks a single ingestion action. One batch == one uploaded file:
 *   - kind='ledger'    → mayor for a specific empresa (empresa required)
 *   - kind='inventory' → consolidated inventory file (empresa = null)
 *
 * A period typically ends up with up to 4 ledger batches (one per empresa)
 * plus 0..1 inventory batch. Each upload is independent: re-uploading
 * SUPERBOL only replaces the SUPERBOL ledger batch; PRUEBAS is untouched.
 *
 * CMV is recomputed every time anything for the period changes, as long
 * as an inventory batch exists. The recomputed totals live on the
 * inventory batch's `stats`. Ledger batches only carry `movementsInserted`.
 */
const ingestionFileSchema = new Schema(
  {
    name: { type: String, required: true },
    hash: { type: String, required: true }, // SHA-256 of file content
    rowsProcessed: { type: Number, default: 0 },
  },
  { _id: false },
);

const ingestionBatchSchema = new Schema(
  {
    periodo: { type: String, required: true, match: /^\d{2}\/\d{4}$/ }, // "MM/YYYY"
    kind: { type: String, enum: ['ledger', 'inventory'], required: true },
    // Required when kind='ledger'; null when kind='inventory'.
    empresa: { type: String, enum: [...EMPRESAS, null], default: null },
    file: { type: ingestionFileSchema, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'success', 'failed'],
      default: 'pending',
      required: true,
    },
    stats: {
      // Populated on every batch:
      movementsInserted: { type: Number, default: 0 },
      // Populated only on inventory batches (CMV totals — recomputed on
      // every change to the period). Stay at 0 on ledger batches.
      inventoryItems: { type: Number, default: 0 },
      stockInicial: { type: Number, default: 0 },
      compras: { type: Number, default: 0 },
      stockFinal: { type: Number, default: 0 },
      cmvBruto: { type: Number, default: 0 },
      costoFinanciero: { type: Number, default: 0 }, // signed
      cmvAjustado: { type: Number, default: 0 },
    },
    errors: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'ingestion_batches',
    suppressReservedKeysWarning: true,
  },
);

ingestionBatchSchema.index({ periodo: 1, createdAt: -1 });
// Per-(periodo, kind, empresa) uniqueness, but only among successful batches.
// Failed batches don't conflict so the user can retry a same-empresa upload.
ingestionBatchSchema.index(
  { periodo: 1, kind: 1, empresa: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'success' },
  },
);

export type IngestionFile = {
  name: string;
  hash: string;
  rowsProcessed: number;
};

export type IngestionBatchKind = 'ledger' | 'inventory';

export type IngestionBatch = {
  _id: Types.ObjectId;
  periodo: string;
  kind: IngestionBatchKind;
  empresa: Empresa | null;
  file: IngestionFile;
  status: 'pending' | 'processing' | 'success' | 'failed';
  stats: {
    movementsInserted: number;
    inventoryItems: number;
    stockInicial: number;
    compras: number;
    stockFinal: number;
    cmvBruto: number;
    costoFinanciero: number;
    cmvAjustado: number;
  };
  errors: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

export const IngestionBatchModel = model('IngestionBatch', ingestionBatchSchema);
