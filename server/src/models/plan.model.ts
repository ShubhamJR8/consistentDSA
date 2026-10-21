import mongoose, { Schema, Document, Types } from 'mongoose';

export const PLAN_LEVELS = ['Basic', 'Medium', 'Advanced'] as const;
export type PlanLevel = (typeof PLAN_LEVELS)[number];

export interface IPlan extends Document<Types.ObjectId> {
  name: string;
  slug: string;
  description: string;
  topic: string | null;
  level: PlanLevel | null;
  problemIds: Types.ObjectId[];
  active: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, required: true, trim: true },
    topic: { type: String, default: null },
    level: { type: String, enum: PLAN_LEVELS, default: null },
    problemIds: [{ type: Schema.Types.ObjectId, ref: 'Problem', required: true }],
    active: { type: Boolean, default: true },
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export const Plan = mongoose.model<IPlan>('Plan', PlanSchema);
