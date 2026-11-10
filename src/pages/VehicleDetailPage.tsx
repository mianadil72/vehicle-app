import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { fetchVehicle, fetchVehicles, useRemote } from '../api';
import { formatMileage, formatPrice } from '../format';
import { PhotoGallery } from '../components/PhotoGallery';
import { RemoteStatus } from '../components/RemoteStatus';
import { VehicleCard } from '../components/VehicleCard';

export function VehicleDetailPage() {
  const { id } = useParams();
  const location = useLocation();

  // Unknown paths (no :id) skip loading and show the "not found" state.
  const remote = useRemote(id ?? null, (signal) => fetchVehicle(id!, signal));
  const pending = id !== undefined && remote.status !== 'ready';
  const vehicle = remote.status === 'ready' ? remote.data : null;

  const similarRemote = useRemote(vehicle ? `similar-${vehicle.id}` : null, (signal) =>
    fetchVehicles({ category: vehicle!.category, exclude: vehicle!.id, limit: 3 }, signal),
  );
  const similar = similarRemote.status === 'ready' ? similarRemote.data : [];

  // Return to the inventory with the same filters the user came from.
  const from = (location.state as { from?: string } | null)?.from;
  const backTo = from && from.startsWith('/') && !from.startsWith('/vehicles/') ? from : '/';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (pending) return;
    document.title = vehicle
      ? `${vehicle.year} ${vehicle.name} ${vehicle.model} | Vehicle Inventory`
      : 'Vehicle not found | Vehicle Inventory';
  }, [vehicle, pending]);

  if (pending) {
    return (
      <>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={backTo}>← Back to inventory</Link>
        </nav>
        <RemoteStatus remote={remote} what="this vehicle" />
      </>
    );
  }

  if (!vehicle) {
    return (
      <div className="empty detail-missing">
        <h2>Vehicle not found</h2>
        <p>It may have been sold or removed from inventory.</p>
        <Link to="/" className="button">Browse inventory</Link>
      </div>
    );
  }

  const v = vehicle;

  const specs: [string, string][] = [
    ['Name', v.name],
    ['Model', v.model],
    ['Year', String(v.year)],
    ['Category', v.category],
    ['Condition', v.condition],
    ['Mileage', formatMileage(v.mileage)],
    ['Exterior color', v.color],
    ['Stock #', v.stockNumber],
  ];

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={backTo}>← Back to inventory</Link>
        <span aria-hidden>/</span>
        <span>{v.category}</span>
        <span aria-hidden>/</span>
        <span aria-current="page">{v.name} {v.model}</span>
      </nav>

      <div className="detail">
        <PhotoGallery key={v.id} vehicle={v} />

        <aside className="detail-summary">
          <div className="detail-pills">
            <span className="pill pill-neutral">{v.category}</span>
            <span className={`pill cond-${v.condition.toLowerCase()}`}>{v.condition}</span>
          </div>
          <p className="card-year">{v.year}</p>
          <h1 className="detail-title">
            {v.name} <span>{v.model}</span>
          </h1>
          <p className="detail-price">{formatPrice(v.price)}</p>

          <dl className="detail-specs">
            {specs.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {label === 'Exterior color' && (
                    <span className="swatch" style={{ background: v.colorHex }} aria-hidden />
                  )}
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      {similar.length > 0 && (
        <section className="similar">
          <h2>More {v.category === 'SUV' ? 'SUVs' : `${v.category.toLowerCase()} vehicles`}</h2>
          <div className="grid">
            {similar.map((o) => <VehicleCard key={o.id} vehicle={o} />)}
          </div>
        </section>
      )}
    </>
  );
}
