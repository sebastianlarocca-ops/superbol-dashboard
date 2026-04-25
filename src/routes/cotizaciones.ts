import { Router, Request, Response, NextFunction } from 'express';
import * as DolarService from '../services/dolar/DolarCotizacionService';

const router = Router();

const PERIODO_RE = /^\d{2}\/\d{4}$/;

// GET /cotizaciones — list all
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await DolarService.listAll();
    res.json({ count: rows.length, cotizaciones: rows });
  } catch (err) {
    next(err);
  }
});

// POST /cotizaciones/sync — fetch from argentinadatos and upsert all
router.post('/sync', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await DolarService.syncAll();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /cotizaciones/:periodo — single period
router.get('/:periodo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo } = req.params;
    if (!PERIODO_RE.test(periodo)) {
      res.status(400).json({ error: 'periodo must be MM/YYYY' });
      return;
    }
    const doc = await DolarService.getByPeriodo(periodo);
    if (!doc) {
      res.status(404).json({ error: `No cotización for ${periodo}` });
      return;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// PUT /cotizaciones/:periodo — manual upsert
router.put('/:periodo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo } = req.params;
    if (!PERIODO_RE.test(periodo)) {
      res.status(400).json({ error: 'periodo must be MM/YYYY' });
      return;
    }
    const { fecha, compra, venta } = req.body as {
      fecha?: string;
      compra?: number;
      venta?: number;
    };
    if (!fecha || compra == null || venta == null) {
      res.status(400).json({ error: 'fecha, compra, venta are required' });
      return;
    }
    const doc = await DolarService.upsertManual(periodo, { fecha, compra, venta });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// DELETE /cotizaciones/:periodo
router.delete('/:periodo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo } = req.params;
    await DolarService.deleteByPeriodo(periodo);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
