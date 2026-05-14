import { Schema, model, Types } from 'mongoose';

const payrollRecordSchema = new Schema(
  {
    payrollBatchId: { type: Schema.Types.ObjectId, ref: 'PayrollBatch', required: true },
    periodo: { type: String, required: true, match: /^\d{2}\/\d{4}$/ },
    nomina: { type: String, required: true, trim: true },
    empresa: { type: String, required: true, trim: true },
    categoriaRecibo: { type: String, default: null, trim: true },
    // sector = sheet name (e.g. "PRODUCCION", "ADMINISTRACION")
    sector: { type: String, required: true, trim: true },
    // subSector = the SECTOR column within each row (can be more specific, e.g. "IMPRESIÓN")
    subSector: { type: String, default: null, trim: true },
    ctaDos: { type: Number, default: 0 },
    sueldoSinAntig: { type: Number, default: 0 },
    antiguedad: { type: Number, default: 0 },
    cargasSociales: { type: Number, default: 0 },
    aportesPersonales: { type: Number, default: 0 },
    totalPorPosicion: { type: Number, default: 0 },
    totalSueldoMasCargas: { type: Number, default: 0 },
    anosAntiguedad: { type: Number, default: null },
    fechaIngreso: { type: Date, default: null },
    esBaja: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'payroll_records' },
);

payrollRecordSchema.index({ periodo: 1, sector: 1 });
payrollRecordSchema.index({ payrollBatchId: 1 });
payrollRecordSchema.index({ periodo: 1, esBaja: 1 });

export type PayrollRecord = {
  _id: Types.ObjectId;
  payrollBatchId: Types.ObjectId;
  periodo: string;
  nomina: string;
  empresa: string;
  categoriaRecibo: string | null;
  sector: string;
  subSector: string | null;
  ctaDos: number;
  sueldoSinAntig: number;
  antiguedad: number;
  cargasSociales: number;
  aportesPersonales: number;
  totalPorPosicion: number;
  totalSueldoMasCargas: number;
  anosAntiguedad: number | null;
  fechaIngreso: Date | null;
  esBaja: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export const PayrollRecordModel = model('PayrollRecord', payrollRecordSchema);
