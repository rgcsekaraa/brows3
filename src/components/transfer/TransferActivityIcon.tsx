import { SvgIcon } from '@mui/material';

export function TransferActivityIcon({ type, active = false }: { type: 'Upload' | 'Download'; active?: boolean }) {
  const upload = type === 'Upload';
  const start = upload ? '2px' : '-2px';
  const end = upload ? '-2px' : '2px';
  const animationName = `transfer-${type.toLowerCase()}`;
  return <SvgIcon fontSize="small" color={active ? 'primary' : 'disabled'} data-transfer-direction={type} sx={{
    flexShrink: 0,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    '& .transfer-arrow': { animation: active ? `${animationName} 1.8s linear infinite` : 'none' },
    [`@keyframes ${animationName}`]: {
      '0%': { transform: `translateY(${start})`, opacity: 0 },
      '20%': { opacity: 1 },
      '70%': { opacity: 1 },
      '100%': { transform: `translateY(${end})`, opacity: 0 },
    },
    '@media (prefers-reduced-motion: reduce)': { '& .transfer-arrow': { animation: 'none' } },
  }}>
    <path d="M5 16v4h14v-4" />
    <path className="transfer-arrow" d={upload ? 'M12 15V5m-4 4 4-4 4 4' : 'M12 4v10m-4-4 4 4 4-4'} />
  </SvgIcon>;
}
