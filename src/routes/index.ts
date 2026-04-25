import { Router } from 'express';
import healthRoutes from './health';
import rulesRoutes from './rules';
import ingestaRoutes from './ingesta';
import reportsRoutes from './reports';

const router = Router();

router.use('/health', healthRoutes);
router.use('/rules', rulesRoutes);
router.use('/ingesta', ingestaRoutes);
router.use('/reports', reportsRoutes);

export default router;
