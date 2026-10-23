import mongoose, { Schema, Document } from 'mongoose';

// Razorpay redelivers events (retries, and at-least-once delivery). Every handler is idempotent on
// its own; this just lets a redelivery of an event we already finished return immediately instead of
// re-running its queries. Recorded only after the event was handled successfully, so a failed
// attempt is retried rather than swallowed. Housekeeping TTL keeps it small.
export interface IProcessedWebhookEvent extends Document {
  eventId: string;
  createdAt: Date;
}

const ProcessedWebhookEventSchema = new Schema<IProcessedWebhookEvent>(
  { eventId: { type: String, required: true, unique: true } },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ProcessedWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const ProcessedWebhookEvent = mongoose.model<IProcessedWebhookEvent>(
  'ProcessedWebhookEvent',
  ProcessedWebhookEventSchema
);
