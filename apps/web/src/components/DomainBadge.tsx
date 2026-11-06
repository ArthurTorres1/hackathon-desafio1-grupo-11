import domain from '../design-system/domain-ui.json';

export default function DomainBadge({ value }: { value: string }) {
  const origin = domain.origins.find(entry => entry.value === value);
  const status = domain.statuses.find(entry => entry.value === value);
  const entry = origin ?? status;
  return <span className={`${origin ? 'ft-origin ft-origin--' : 'ft-status ft-status--'}${entry?.variant ?? 'pending'}`} title={entry?.meaning}>
    {entry?.label ?? value}{entry && <small> · {value}</small>}
  </span>;
}
