import { Schema, model, Types } from 'mongoose';
import { EMPRESAS, Empresa } from '../types/empresa';

/**
 * Tracks a monthly ingestion (one per period). One batch references the 4
 * ledger files + 1 inventory file and carries aggregate stats so we can
 * reprocess / delete by batchId.
 */
const ingestionFileSchema = new Schema(
  {
    name: { type: String, required: true },
    hash: { type: String, required: true }, // SHA-256 of file content, for dedupe
    kind: { type: String, enum: ['ledger', 'inventory'], required: true },
    empresa: { type: String, enum: EMPRESAS, default: null }, // only for ledger
    rowsProcessed: { type: Number, default: 0 },
  },
  { _id: false },
);

const ingestionBatchSchema = new Schema(
  {
    periodo: { type: String, required: true, match: /^\d{2}\/\d{4}$/ }, // "MM/YYYY"
    files: { type: [ingestionFileSchema], default: [] },
    status: {
      type: String,
      enum: ['pending', 'processing', 'success', 'failed'],
      default: 'pending',
      required: true,
    },
    stats: {
      movementsInserted: { type: Number, default: 0 },
      inventoryItems: { type: Number, default: 0 },
      // CMV consolidado del período (se imputa a SUPERBOL)
      stockInicial: { type: Number, default: 0 }, // Σ SI = Σ (unidMesAnterior × precioMesAnterior)
      compras: { type: Number, default: 0 }, // Σ (debe − haber) cuentas 1600+1620+6200 pre-reimputación
      stockFinal: { type: Number, default: 0 }, // Σ SF = Σ (unidMesEnCurso × precioMesEnCurso)
      cmvBruto: { type: Number, default: 0 }, // stockInicial + compras − stockFinal
      costoFinanciero: { type: Number, default: 0 }, // signed (+ gan / − pérd)
      cmvAjustado: { type: Number, default: 0 }, // cmvBruto − costoFinanciero
    },
    errors: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'ingestion_batches',
    // `errors` is a reserved word in Mongoose — we use it deliberately for
    // surfacing ingestion failures and accept the risk per Mongoose docs.
    suppressReservedKeysWarning: true,
  },
);

ingestionBatchSchema.index({ periodo: 1, createdAt: -1 });

export type IngestionFile = {
  name: string;
  hash: string;
  kind: 'ledger' | 'inventory';
  empresa: Empresa | null;
  rowsProcessed: number;
};

export type IngestionBatch = {
  _id: Types.ObjectId;
  periodo: string;
  files: IngestionFile[];
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
