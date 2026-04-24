import { Schema, model, InferSchemaType, Types } from 'mongoose';

/**
 * One row of the inventory INFORME sheet. Feeds the CMV calculation:
 *   EF - EI per item = (unidMesEnCurso * precioMesEnCurso)
 *                    - (unidMesAnterior * precioMesAnterior)
 * plus a financial-result component when both months have units and prices
 * differ.
 */
const inventoryItemSchema = new Schema(
  {
    periodo: { type: String, required: true, match: /^\d{2}\/\d{4}$/ }, // "MM/YYYY"
    ingestionBatchId: {
      type: Schema.Types.ObjectId,
      ref: 'IngestionBatch',
      required: true,
    },

    categoria: { type: String, required: true, trim: true },

    unidMesAnterior: { type: Number, default: 0 },
    precioMesAnterior: { type: Number, default: 0 },
    unidMesEnCurso: { type: Number, default: 0 },
    precioMesEnCurso: { type: Number, default: 0 },

    // Extras from INFORME sheet (kept raw for audit, not used in CMV formula)
    valorFinal: { type: Number, default: null },
    mermaPct: { type: Number, default: null },
    notas: { type: String, default: null },
  },
  { timestamps: true, collection: 'inventory_items' },
);

inventoryItemSchema.index({ periodo: 1 });
inventoryItemSchema.index({ ingestionBatchId: 1 });

export type InventoryItem = InferSchemaType<typeof inventoryItemSchema> & {
  _id: Types.ObjectId;
};
export const InventoryItemModel = model('InventoryItem', inventoryItemSchema);
