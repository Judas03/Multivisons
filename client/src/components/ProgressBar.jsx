export default function ProgressBar({ value = 0, label, tone, threshold }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-track">
        <div className={`progress-fill ${tone || ''}`} style={{ width: `${v}%` }} />
        {threshold != null && <div className="progress-mark" style={{ left: `${threshold}%` }} title={`Release threshold ${threshold}%`} />}
      </div>
      <span className="progress-num">{v}%</span>
    </div>
  );
}
