import { Link, useLocation } from 'react-router';
import type { Vehicle } from '../types';
import { formatMileage, formatPrice } from '../format';

export function VehicleTable({ vehicles }: { vehicles: Vehicle[] }) {
  const location = useLocation();
  const from = location.pathname + location.search;
  return (
    <div className="table-wrap table-cards-wrap">
      {/* On phones, .table-cards shows each row as a card, labelling cells with data-label. */}
      <table className="table-cards">
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
              <td className="cell-title">
                <Link to={`/vehicles/${v.id}`} state={{ from }} className="row-link">
                  {v.name}
                  <span className="cards-only"> {v.model}</span>
                </Link>
              </td>
              <td data-label="Model" className="cards-hide">{v.model}</td>
              <td data-label="Year" className="num">{v.year}</td>
              <td data-label="Price" className="num strong">{formatPrice(v.price)}</td>
              <td data-label="Category">{v.category}</td>
              <td data-label="Condition">
                <span className={`pill cond-${v.condition.toLowerCase()}`}>{v.condition}</span>
              </td>
              <td data-label="Mileage" className="num">{formatMileage(v.mileage)}</td>
              <td data-label="Stock #" className="mono">{v.stockNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
