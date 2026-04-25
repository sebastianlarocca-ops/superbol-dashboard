import { Schema, model, Types } from 'mongoose';

/**
 * One row of the inventory INFORME sheet, already valorized.
 *
 * Fórmula CMV (a nivel total del período):
 *   CMV = Σ valorMesAnterior (SI) + Compras − Σ valorMesEnCurso (SF)
 *
 * Costo financiero (por tenencia de inventario) — por ítem:
 *   deltaPrecio = precioMesEnCurso − precioMesAnterior
 *   Caso A (unidMesAnterior >  unidMesEnCurso): costoFinanciero = unidMesEnCurso  × deltaPrecio
 *   Caso B (unidMesAnterior <= unidMesEnCurso): costoFinanciero = unidMesAnterior × deltaPrecio
 *   Signo: + = ganancia por tenencia (precio subió); − = pérdida (precio bajó).
 *
 * Para el P&L: la ganancia se RESTA del CMV y se expone como "Resultado por
 * tenencia de inventario" dentro del subrubro "Resultados financieros"
 * (pérdida idem pero con signo opuesto). Se imputa a SUPERBOL (consolidado —
 * las otras empresas son "medio pantalla").
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

    // SI: stock inicial (mes anterior — junio, en el archivo de julio)
    unidMesAnterior: { type: Number, default: 0 },
    precioMesAnterior: { type: Number, default: 0 },
    valorMesAnterior: { type: Number, default: 0 }, // = unidMesAnterior × precioMesAnterior

    // SF: stock final (mes en curso — julio)
    unidMesEnCurso: { type: Number, default: 0 },
    precioMesEnCurso: { type: Number, default: 0 },
    valorMesEnCurso: { type: Number, default: 0 }, // = unidMesEnCurso × precioMesEnCurso

    // Costo financiero
    deltaPrecio: { type: Number, default: 0 }, // precioMesEnCurso − precioMesAnterior
    casoCalculado: { type: String, enum: ['A', 'B'], required: true },
    unidadesAfectadas: { type: Number, default: 0 }, // min(SI, SF) unid
    costoFinanciero: { type: Number, default: 0 }, // signed (+ ganancia, − pérdida)

    // Extra from INFORME sheet (kept raw for audit)
    mermaPct: { type: Number, default: null },
  },
  { timestamps: true, collection: 'inventory_items' },
);

inventoryItemSchema.index({ periodo: 1 });
inventoryItemSchema.index({ ingestionBatchId: 1 });

export type InventoryItem = {
  _id: Types.ObjectId;
  periodo: string;
  ingestionBatchId: Types.ObjectId;
  categoria: string;
  unidMesAnterior: number;
  precioMesAnterior: number;
  valorMesAnterior: number;
  unidMesEnCurso: number;
  precioMesEnCurso: number;
  valorMesEnCurso: number;
  deltaPrecio: number;
  casoCalculado: 'A' | 'B';
  unidadesAfectadas: number;
  costoFinanciero: number;
  mermaPct: number | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export const InventoryItemModel = model('InventoryItem', inventoryItemSchema);
