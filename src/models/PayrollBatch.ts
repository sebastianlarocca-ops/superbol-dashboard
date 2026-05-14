import { Schema, model, Types } from 'mongoose';

const payrollBatchSchema = new Schema(
  {
    periodo: { type: String, required: true, match: /^\d{2}\/\d{4}$/ },
    file: {
      name: { type: String, required: true },
      hash: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'success', 'failed'],
      default: 'pending',
      required: true,
    },
    stats: {
      recordCount: { type: Number, default: 0 },
      totalCost: { type: Number, default: 0 },
      pseudoMovementsInserted: { type: Number, default: 0 },
    },
    errors: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'payroll_batches' },
);

payrollBatchSchema.index({ periodo: 1, createdAt: -1 });
payrollBatchSchema.index(
  { periodo: 1 },
  { unique: true, partialFilterExpression: { status: 'success' } },
);

export type PayrollBatch = {
  _id: Types.ObjectId;
  periodo: string;
  file: { name: string; hash: string };
  status: 'pending' | 'processing' | 'success' | 'failed';
  stats: {
    recordCount: number;
    totalCost: number;
    pseudoMovementsInserted: number;
  };
  errors: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

export const PayrollBatchModel = model('PayrollBatch', payrollBatchSchema);
