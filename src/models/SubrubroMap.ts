import { Schema, model, InferSchemaType, Types } from 'mongoose';

/**
 * Maps a reimputed account name to a subrubro (sub-category).
 * Mirrors the `Subrubros` tab of `reimputaciones.xlsx`.
 *
 * Applied AFTER reimputation: lookup by `movement.nombreCuentaReimputada`.
 */
const subrubroMapSchema = new Schema(
  {
    nombreCuentaReimputada: { type: String, required: true, unique: true, trim: true },
    nombreSubrubro: { type: String, required: true, trim: true },
  },
  { timestamps: true, collection: 'subrubro_map' },
);

export type SubrubroMap = InferSchemaType<typeof subrubroMapSchema> & { _id: Types.ObjectId };
export const SubrubroMapModel = model('SubrubroMap', subrubroMapSchema);
