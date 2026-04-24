import { Schema, model, InferSchemaType, Types } from 'mongoose';
import { EMPRESAS, RUBROS } from '../types/empresa';

/**
 * The main document. One row = one accounting entry (an `asiento` line).
 * Shape mirrors the enriched output of the n8n workflow — raw ledger fields
 * plus reimputation/subrubro/anulacion enrichment plus `periodo` + `empresa`.
 *
 * `numeroCuentaReimputada` is a string because some reimputation targets are
 * non-numeric (e.g. "f001").
 */
const movementSchema = new Schema(
  {
    // Ingestion metadata
    empresa: { type: String, enum: EMPRESAS, required: true },
    periodo: { type: String, required: true, match: /^\d{2}\/\d{4}$/ }, // "MM/YYYY"
    fechaISO: { type: Date, required: true },
    archivo: { type: String, required: true },
    ingestionBatchId: {
      type: Schema.Types.ObjectId,
      ref: 'IngestionBatch',
      required: true,
    },
    sourceType: {
      type: String,
      enum: ['ledger', 'cmv-calc'],
      default: 'ledger',
      required: true,
    },

    // Raw ledger fields
    asiento: { type: Number, required: true },
    numeroCuenta: { type: Number, required: true },
    nombreCuenta: { type: String, required: true, trim: true },
    numeroSubcuenta: { type: Number, default: null },
    nombreSubcuenta: { type: String, default: null, trim: true },
    rubro: { type: String, enum: RUBROS, required: true },
    detalle: { type: String, default: '', trim: true },
    debe: { type: Number, default: 0 },
    haber: { type: Number, default: 0 },

    // Enrichment
    numeroCuentaReimputada: { type: String, required: true, trim: true },
    nombreCuentaReimputada: { type: String, required: true, trim: true },
    rubroReimputada: { type: String, enum: RUBROS, required: true },
    subrubro: { type: String, default: null, trim: true },
    anulacion: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'movements' },
);

// Indexes for common queries
movementSchema.index({ empresa: 1, periodo: 1 });
movementSchema.index({ ingestionBatchId: 1 });
movementSchema.index({ periodo: 1, rubroReimputada: 1, numeroCuentaReimputada: 1 });
movementSchema.index({ periodo: 1, subrubro: 1 });
movementSchema.index({ fechaISO: 1 });

export type Movement = InferSchemaType<typeof movementSchema> & { _id: Types.ObjectId };
export const MovementModel = model('Movement', movementSchema);
