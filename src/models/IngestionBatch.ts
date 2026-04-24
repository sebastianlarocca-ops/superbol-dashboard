import { Schema, model, InferSchemaType, Types } from 'mongoose';
import { EMPRESAS } from '../types/empresa';

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
      cmvAmount: { type: Number, default: 0 },
      financialResult: { type: Number, default: 0 },
      inventoryItems: { type: Number, default: 0 },
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

export type IngestionBatch = InferSchemaType<typeof ingestionBatchSchema> & {
  _id: Types.ObjectId;
};
export const IngestionBatchModel = model('IngestionBatch', ingestionBatchSchema);
