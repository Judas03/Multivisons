import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
} catch (err) {
  console.error(`Could not reach MongoDB at ${config.mongoUri}\n${err.message}\nStart it with: docker compose up -d db`);
  process.exit(1);
}

createApp().listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
