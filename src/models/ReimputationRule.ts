import { Schema, model, Types } from 'mongoose';

/**
 * Rule that reassigns accounting movements from an original account/sub-account
 * to a target account. Mirrors the `Sheet1` tab of `reimputaciones.xlsx`.
 *
 * Match semantics (from n8n workflow): a movement matches when
 *   movement.nombreCuenta === rule.desde.nombreCuenta
 *   AND (rule.desde.nombreSubcuenta is null OR movement.nombreSubcuenta === rule.desde.nombreSubcuenta)
 *
 * `hacia.numeroCuenta` is a string because some values are non-numeric (e.g. "f001").
 */
const reimputationRuleSchema = new Schema(
  {
    desde: {
      // String everywhere: some plans use alphanumeric codes (f001, z001, g300),
      // subaccount ids can be 17-digit CUIT-like numbers, and leading zeros
      // ("0001") are significant.
      numeroCuenta: { type: String, required: true, trim: true },
      nombreCuenta: { type: String, required: true, trim: true },
      numeroSubcuenta: { type: String, default: null, trim: true },
      nombreSubcuenta: { type: String, default: null, trim: true },
    },
    hacia: {
      numeroCuenta: { type: String, required: true, trim: true },
      nombreCuenta: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true, collection: 'reimputation_rules' },
);

// Natural key for idempotent upsert: desde.nombreCuenta + desde.nombreSubcuenta
reimputationRuleSchema.index(
  { 'desde.nombreCuenta': 1, 'desde.nombreSubcuenta': 1 },
  { unique: true },
);

// Explicit type — Mongoose's InferSchemaType marks nested subdocs as optional
// even when they're schema-required, which breaks consumers at compile time.
export type ReimputationRule = {
  _id: Types.ObjectId;
  desde: {
    numeroCuenta: string;
    nombreCuenta: string;
    numeroSubcuenta: string | null;
    nombreSubcuenta: string | null;
  };
  hacia: {
    numeroCuenta: string;
    nombreCuenta: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
};

export const ReimputationRuleModel = model('ReimputationRule', reimputationRuleSchema);
