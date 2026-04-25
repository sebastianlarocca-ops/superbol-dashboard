import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/axios';
import { fmtMoney, fmtMoneyCompact } from '../lib/format';

type Currency = 'ARS' | 'USD';

type Cotizacion = {
  periodo: string;
  promedio: number;
};

type CurrencyContextValue = {
  currency: Currency;
  toggle: () => void;
  /** Convert an ARS amount to current display currency. Returns null if USD and no rate. */
  convert: (ars: number, periodo: string | null | undefined) => number | null;
  /** Format an ARS value in the current display currency. Returns '—' if no rate. */
  fmt: (ars: number, periodo: string | null | undefined) => string;
  fmtCompact: (ars: number, periodo: string | null | undefined) => string;
  /** True while cotizaciones are loading */
  loading: boolean;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

type CotizacionesResponse = {
  count: number;
  cotizaciones: Cotizacion[];
};

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>(() => {
    return (localStorage.getItem('superbol_currency') as Currency) ?? 'ARS';
  });

  const toggle = useCallback(() => {
    setCurrency((c) => {
      const next = c === 'ARS' ? 'USD' : 'ARS';
      localStorage.setItem('superbol_currency', next);
      return next;
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['cotizaciones'],
    queryFn: async () =>
      (await api.get<CotizacionesResponse>('/cotizaciones')).data,
    staleTime: 5 * 60_000,
  });

  // Build a map: periodo → promedio
  const rateMap = new Map<string, number>(
    data?.cotizaciones.map((c) => [c.periodo, c.promedio]) ?? [],
  );

  const convert = useCallback(
    (ars: number, periodo: string | null | undefined): number | null => {
      if (currency === 'ARS') return ars;
      if (!periodo) return null;
      const rate = rateMap.get(periodo);
      if (!rate) return null;
      return ars / rate;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, data],
  );

  const fmt = useCallback(
    (ars: number, periodo: string | null | undefined): string => {
      const val = convert(ars, periodo);
      if (val === null) return '—';
      return (currency === 'USD' ? 'USD ' : '') + fmtMoney(val);
    },
    [convert, currency],
  );

  const fmtCompact = useCallback(
    (ars: number, periodo: string | null | undefined): string => {
      const val = convert(ars, periodo);
      if (val === null) return '—';
      return (currency === 'USD' ? 'USD ' : '') + fmtMoneyCompact(val);
    },
    [convert, currency],
  );

  return (
    <CurrencyContext.Provider value={{ currency, toggle, convert, fmt, fmtCompact, loading: isLoading }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used inside CurrencyProvider');
  return ctx;
}
