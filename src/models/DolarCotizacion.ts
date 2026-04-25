import { Schema, model } from 'mongoose';

const dolarCotizacionSchema = new Schema(
  {
    /** MM/YYYY — one record per calendar month */
    periodo: { type: String, required: true, unique: true },
    /** Representative date used for this month (usually the last trading day) */
    fecha: { type: String, required: true },
    compra: { type: Number, required: true },
    venta: { type: Number, required: true },
    /** (compra + venta) / 2 — computed and stored for query convenience */
    promedio: { type: Number, required: true },
    /** 'sync' = populated by argentinadatos API; 'manual' = entered by user */
    fuente: { type: String, enum: ['sync', 'manual'], default: 'sync' },
  },
  { timestamps: true },
);

export type DolarCotizacion = {
  _id: string;
  periodo: string;
  fecha: string;
  compra: number;
  venta: number;
  promedio: number;
  fuente: 'sync' | 'manual';
  createdAt: Date;
  updatedAt: Date;
};

export const DolarCotizacionModel = model('DolarCotizacion', dolarCotizacionSchema);
