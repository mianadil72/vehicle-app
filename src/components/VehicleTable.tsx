import { Link, useLocation } from 'react-router';
import type { Vehicle } from '../types';
import { formatMileage, formatPrice } from '../format';

export function VehicleTable({ vehicles }: { vehicles: Vehicle[] }) {
  const location = useLocation();
  const from = location.pathname + location.search;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Model</th>
            <th className="num">Year</th>
            <th className="num">Price</th>
            <th>Category</th>
            <th>Condition</th>
            <th className="num">Mileage</th>
            <th>Stock #</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.id}>
              <td>
                <Link to={`/vehicles/${v.id}`} state={{ from }} className="row-link">{v.name}</Link>
              </td>
              <td>{v.model}</td>
              <td className="num">{v.year}</td>
              <td className="num strong">{formatPrice(v.price)}</td>
              <td>{v.category}</td>
              <td>
                <span className={`pill cond-${v.condition.toLowerCase()}`}>{v.condition}</span>
              </td>
              <td className="num">{formatMileage(v.mileage)}</td>
              <td className="mono">{v.stockNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
