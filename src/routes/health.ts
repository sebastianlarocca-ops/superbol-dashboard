import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
