import { Router, Request, Response, NextFunction } from 'express';
import {
  ReimputationRuleModel,
  AnulacionRuleModel,
  SubrubroMapModel,
} from '../models';

/**
 * Read-only endpoints to inspect the 3 rule collections.
 * Used for the rule-review pass before we wire them into ingestion.
 *
 * GET /api/v1/rules/reimputations
 * GET /api/v1/rules/anulaciones
 * GET /api/v1/rules/subrubros
 */
const router = Router();

router.get('/reimputations', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await ReimputationRuleModel.find()
      .sort({ 'desde.numeroCuenta': 1, 'desde.numeroSubcuenta': 1 })
      .lean();
    res.json({ count: rules.length, rules });
  } catch (err) {
    next(err);
  }
});

router.get('/anulaciones', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await AnulacionRuleModel.find()
      .sort({ 'cuenta.numeroCuenta': 1, 'subcuenta.numeroSubcuenta': 1 })
      .lean();
    res.json({ count: rules.length, rules });
  } catch (err) {
    next(err);
  }
});

router.get('/subrubros', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await SubrubroMapModel.find().sort({ nombreCuentaReimputada: 1 }).lean();
    res.json({ count: rules.length, rules });
  } catch (err) {
    next(err);
  }
});

export default router;
