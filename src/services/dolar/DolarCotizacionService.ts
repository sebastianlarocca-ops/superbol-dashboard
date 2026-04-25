import axios from 'axios';
import { DolarCotizacionModel } from '../../models';

const API_URL = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa';

type ApiRecord = {
  casa: string;
  compra: number;
  venta: number;
  fecha: string; // "YYYY-MM-DD"
};

/** Convert "YYYY-MM-DD" → "MM/YYYY" */
function toPeriodo(fecha: string): string {
  const [year, month] = fecha.split('-');
  return `${month}/${year}`;
}

/**
 * Fetch all bolsa history from argentinadatos, group by month,
 * keep the record with the highest (most recent) fecha per month.
 */
async function fetchLatestByMonth(): Promise<Map<string, ApiRecord>> {
  const { data } = await axios.get<ApiRecord[]>(API_URL, { timeout: 15_000 });
  const best = new Map<string, ApiRecord>();
  for (const r of data) {
    if (!r.compra || !r.venta) continue;
    const periodo = toPeriodo(r.fecha);
    const existing = best.get(periodo);
    if (!existing || r.fecha > existing.fecha) {
      best.set(periodo, r);
    }
  }
  return best;
}

/**
 * Fetch all history from the API and upsert into the DB.
 * Records with fuente='manual' are never overwritten.
 * Returns counts of upserted and skipped records.
 */
export async function syncAll(): Promise<{ upserted: number; skipped: number }> {
  const byMonth = await fetchLatestByMonth();
  let upserted = 0;
  let skipped = 0;

  for (const [periodo, r] of byMonth) {
    const existing = await DolarCotizacionModel.findOne({ periodo }).lean();
    if (existing?.fuente === 'manual') {
      skipped++;
      continue;
    }
    const promedio = (r.compra + r.venta) / 2;
    await DolarCotizacionModel.findOneAndUpdate(
      { periodo },
      { periodo, fecha: r.fecha, compra: r.compra, venta: r.venta, promedio, fuente: 'sync' },
      { upsert: true, new: true },
    );
    upserted++;
  }

  return { upserted, skipped };
}

export async function listAll() {
  return DolarCotizacionModel.find().sort({ periodo: -1 }).lean();
}

export async function getByPeriodo(periodo: string) {
  return DolarCotizacionModel.findOne({ periodo }).lean();
}

export async function upsertManual(
  periodo: string,
  data: { fecha: string; compra: number; venta: number },
) {
  const promedio = (data.compra + data.venta) / 2;
  return DolarCotizacionModel.findOneAndUpdate(
    { periodo },
    { ...data, promedio, fuente: 'manual' },
    { upsert: true, new: true },
  );
}

export async function deleteByPeriodo(periodo: string) {
  return DolarCotizacionModel.deleteOne({ periodo });
}
