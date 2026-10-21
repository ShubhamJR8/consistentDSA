import mongoose from 'mongoose';
import { env } from './env.js';

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI);
    console.log(`[Database] MongoDB Connected: ${conn.connection.host} (${conn.connection.name})`);
  } catch (error) {
    console.error('[Database] MongoDB connection error:', error);
    process.exit(1);
  }
};
