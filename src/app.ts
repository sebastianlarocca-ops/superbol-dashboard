import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { connectDB } from './config/db';
import { env } from './config/env';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(morgan(env.isDev ? 'dev' : 'combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

const start = async (): Promise<void> => {
  await connectDB();
  app.listen(env.PORT, () => {
    console.log(`[Superbol] Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    console.log(`Health: http://localhost:${env.PORT}/api/v1/health`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
