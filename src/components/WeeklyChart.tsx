import { formatDay } from '../format';

/**
 * Vehicles sold per week (Mon–Sun) as vertical bars: one series, in --accent. Each bar is labelled with its
 * value, and a visually hidden table carries the same numbers for screen readers.
 */
export function WeeklyChart({ weeks, units, title }: { weeks: string[]; units: number[]; title: string }) {
  const max = Math.max(1, ...units);
  return (
    <figure className="week-chart">
      <figcaption className="panel-title">{title}</figcaption>
      <div className="week-bars" aria-hidden="true">
        {weeks.map((w, i) => (
          <div key={w} className={i === weeks.length - 1 ? 'week-col current' : 'week-col'}>
            <span className="week-value">{units[i]}</span>
            <span className="week-track">
              <span className="week-bar" style={{ height: `${(units[i] / max) * 100}%` }} />
            </span>
            <span className="week-label">{formatDay(w)}</span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Vehicles sold</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={w}>
              <td>{formatDay(w)}</td>
              <td>{units[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
