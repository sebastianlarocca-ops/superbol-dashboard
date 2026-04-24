import { Router } from 'express';
import healthRoutes from './health';
import rulesRoutes from './rules';

const router = Router();

router.use('/health', healthRoutes);
router.use('/rules', rulesRoutes);

export default router;
