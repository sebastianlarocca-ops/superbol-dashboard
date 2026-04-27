import { DollarSign } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import clsx from 'clsx';

export function CurrencyToggle() {
  const { currency, toggle } = useCurrency();
  const active = currency === 'USD';

  return (
    <button
      onClick={toggle}
      className={clsx(
        'ds-chip w-full justify-center cursor-pointer transition-colors',
        active && 'ds-chip-gain',
      )}
      title={active ? 'Cambiar a ARS' : 'Cambiar a USD'}
      style={{ padding: '6px 10px' }}
    >
      <DollarSign size={12} />
      <span>{active ? 'Viendo en USD' : 'Ver en USD'}</span>
    </button>
  );
}
