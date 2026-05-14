import dotenv from 'dotenv';
dotenv.config();

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '5001', 10),
  MONGO_URI: requireEnv('MONGO_URI'),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  JWT_SECRET: process.env.JWT_SECRET ?? 'change-me-in-production',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'admin123',
  CLIENT_PASSWORD: process.env.CLIENT_PASSWORD ?? 'cliente123',
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
};
