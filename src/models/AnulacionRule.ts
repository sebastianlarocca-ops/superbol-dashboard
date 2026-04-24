import { Schema, model, InferSchemaType, Types } from 'mongoose';

/**
 * Rule that marks movements as "anulacion" (void). Mirrors the `Anulaciones`
 * tab of `reimputaciones.xlsx`.
 *
 * Match semantics (from n8n workflow): a movement matches when
 *   movement.nombreCuenta === rule.cuenta.nombreCuenta
 *   AND movement.nombreSubcuenta === rule.subcuenta.nombreSubcuenta
 */
const anulacionRuleSchema = new Schema(
  {
    cuenta: {
      // See ReimputationRule for rationale on string over number.
      numeroCuenta: { type: String, required: true, trim: true },
      nombreCuenta: { type: String, required: true, trim: true },
    },
    subcuenta: {
      numeroSubcuenta: { type: String, required: true, trim: true },
      nombreSubcuenta: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true, collection: 'anulacion_rules' },
);

anulacionRuleSchema.index(
  { 'cuenta.nombreCuenta': 1, 'subcuenta.nombreSubcuenta': 1 },
  { unique: true },
);

export type AnulacionRule = InferSchemaType<typeof anulacionRuleSchema> & {
  _id: Types.ObjectId;
};
export const AnulacionRuleModel = model('AnulacionRule', anulacionRuleSchema);
