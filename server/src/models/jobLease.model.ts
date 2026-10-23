import mongoose, { Schema } from 'mongoose';

// A lease, not a lock: it expires on its own, so a crashed instance can never wedge a sweep. See
// utils/jobLease.ts.
export interface IJobLease {
  _id: string;
  holder: string;
  expiresAt: Date;
}

const JobLeaseSchema = new Schema<IJobLease>(
  {
    _id: { type: String, required: true },
    holder: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

export const JobLease = mongoose.model<IJobLease>('JobLease', JobLeaseSchema);
