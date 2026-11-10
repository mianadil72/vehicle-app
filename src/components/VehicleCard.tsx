import { Link, useLocation } from 'react-router';
import type { Vehicle } from '../types';
import { formatMileage, formatPrice } from '../format';
import { VehiclePhoto } from './VehiclePhoto';

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const v = vehicle;
  const location = useLocation();
  return (
    <Link to={`/vehicles/${v.id}`} state={{ from: location.pathname + location.search }} className="card">
      <div className="card-media">
        <VehiclePhoto vehicle={v} className="card-image" />
        <span className="pill card-cat">{v.category}</span>
        <span className={`pill card-cond cond-${v.condition.toLowerCase()}`}>{v.condition}</span>
      </div>
      <div className="card-body">
        <p className="card-year">{v.year}</p>
        <h3 className="card-title">
          {v.name} <span>{v.model}</span>
        </h3>
        <p className="card-price">{formatPrice(v.price)}</p>
        <dl className="card-specs">
          <div>
            <dt>Mileage</dt>
            <dd>{formatMileage(v.mileage)}</dd>
          </div>
          <div>
            <dt>Color</dt>
            <dd>{v.color}</dd>
          </div>
          <div>
            <dt>Stock #</dt>
            <dd>{v.stockNumber}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
