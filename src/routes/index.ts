import { Router, Request, Response, NextFunction } from 'express';
import healthRoutes from './health';
import rulesRoutes from './rules';
import ingestaRoutes from './ingesta';
import reportsRoutes from './reports';
import movimientosRoutes from './movimientos';
import cotizacionesRoutes from './cotizaciones';
import nominaRoutes from './nomina';
import authRoutes from './auth';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/authenticate';

const router = Router();

// Public
router.use('/auth', authRoutes);

// Require auth for everything below
router.use(authenticate);

router.use('/health', healthRoutes);
router.use('/rules', rulesRoutes);
router.use('/reports', reportsRoutes);

// Mixed: reads for any role, writes for admin only
const adminOnWrites = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return requireAdmin(req, res, next);
  }
  next();
};

router.use('/movimientos', adminOnWrites, movimientosRoutes);
router.use('/cotizaciones', adminOnWrites, cotizacionesRoutes);
router.use('/nomina', adminOnWrites, nominaRoutes);

// Admin only (all methods)
router.use('/ingesta', requireAdmin, ingestaRoutes);

export default router;
