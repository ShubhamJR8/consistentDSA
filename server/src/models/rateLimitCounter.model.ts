import mongoose, { Schema } from 'mongoose';

// One document per rate-limit key (limiter prefix + client). Shared by every server instance, which
// is the point: an in-memory counter lets a client make N times the limit across N instances.
export interface IRateLimitCounter {
  _id: string;
  hits: number;
  resetAt: Date;
}

const RateLimitCounterSchema = new Schema<IRateLimitCounter>(
  {
    _id: { type: String, required: true },
    hits: { type: Number, required: true },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false }
);
// Housekeeping only; correctness never depends on it, because every read compares resetAt itself.
RateLimitCounterSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitCounter = mongoose.model<IRateLimitCounter>(
  'RateLimitCounter',
  RateLimitCounterSchema
);
