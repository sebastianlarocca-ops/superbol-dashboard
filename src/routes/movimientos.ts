import { Router, Request, Response, NextFunction } from 'express';
import {
  createManualMovement,
  deleteManualMovement,
  getCuentasCatalog,
  listManualMovements,
  updateManualMovement,
} from '../services/movements/ManualMovementService';
import { EMPRESAS, Empresa } from '../types/empresa';

/**
 * Endpoints for manual movements (the ones the contador doesn't put in the
 * mayor — IIBB, salaries, honorarios directores).
 *
 *   POST   /api/v1/movimientos/manual
 *   GET    /api/v1/movimientos/manual?periodo=&empresa=
 *   PATCH  /api/v1/movimientos/manual/:id
 *   DELETE /api/v1/movimientos/manual/:id
 *   GET    /api/v1/movimientos/cuentas
 */
const router = Router();

const parseEmpresa = (raw: unknown, res: Response): Empresa | undefined | null => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !(EMPRESAS as readonly string[]).includes(raw)) {
    res.status(400).json({
      error: `empresa "${raw}" inválida. Opciones: ${EMPRESAS.join(', ')}`,
    });
    return null;
  }
  return raw as Empresa;
};

router.post('/manual', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createManualMovement(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/manual', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = (req.query.periodo as string | undefined)?.trim();
    if (!periodo) {
      res.status(400).json({ error: 'periodo requerido' });
      return;
    }
    const empresa = parseEmpresa(req.query.empresa, res);
    if (empresa === null) return;

    const movements = await listManualMovements(periodo, empresa);
    res.json({ count: movements.length, movements });
  } catch (err) {
    next(err);
  }
});

router.patch('/manual/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await updateManualMovement(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/manual/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteManualMovement(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * Catalog of (numeroCuenta, nombreCuenta) pairs to power the autocomplete
 * in the manual-entry form. Sorted by usage count desc.
 */
router.get('/cuentas', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await getCuentasCatalog();
    res.json({ count: items.length, items });
  } catch (err) {
    next(err);
  }
});

export default router;
