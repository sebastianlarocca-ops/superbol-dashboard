import { DollarSign } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import clsx from 'clsx';

export function CurrencyToggle() {
  const { currency, toggle } = useCurrency();

  return (
    <button
      onClick={toggle}
      className={clsx(
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors w-full',
        currency === 'USD'
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white',
      )}
      title={currency === 'ARS' ? 'Cambiar a USD' : 'Cambiar a ARS'}
    >
      <DollarSign size={14} />
      <span>{currency === 'ARS' ? 'Ver en USD' : 'Viendo en USD'}</span>
    </button>
  );
}
