import { useEffect, useState } from 'react';
import type { Vehicle } from '../types';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError, deleteVehicle, fetchVehicle, fetchVehicles, useRemote } from '../api';
import { authErrorMessage, useAuth } from '../auth';
import type { NavState } from '../navigation';
import { formatMileage, formatPrice } from '../format';
import { PhotoGallery } from '../components/PhotoGallery';
import { RemoteStatus } from '../components/RemoteStatus';
import { VehicleCard } from '../components/VehicleCard';
import { VehicleComments } from '../components/VehicleComments';

export function VehicleDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { isAdmin } = useAuth();

  // Unknown paths (no :id) skip loading and show the "not found" state.
  const remote = useRemote(id ?? null, (signal) => fetchVehicle(id!, signal));
  const pending = id !== undefined && remote.status !== 'ready';
  const vehicle = remote.status === 'ready' ? remote.data : null;

  const similarRemote = useRemote(vehicle ? `similar-${vehicle.id}` : null, (signal) =>
    fetchVehicles({ category: vehicle!.category, exclude: vehicle!.id, limit: 3 }, signal),
  );
  const similar = similarRemote.status === 'ready' ? similarRemote.data : [];

  // Return to the inventory with the same filters the user came from.
  const from = (location.state as NavState | null)?.from;
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

          {isAdmin && <VehicleActions key={v.id} vehicle={v} backTo={backTo} />}
        </aside>
      </div>

      <VehicleComments key={v.id} vehicleId={v.id} />

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

/** Edit and Delete buttons, with an inline confirmation before deleting. */
function VehicleActions({ vehicle: v, backTo }: { vehicle: Vehicle; backTo: string }) {
  const navigate = useNavigate();
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVehicle(v.id);
    } catch (err) {
      // Already gone counts as deleted.
      if (!(err instanceof ApiError && err.status === 404)) {
        setDeleting(false);
        const authProblem = authErrorMessage(err);
        if (authProblem) auth.refresh(); // Re-check the session; the buttons disappear if it ended.
        setDeleteError(authProblem ?? "Couldn't delete this vehicle. Check that the API server is running, then try again.");
        return;
      }
    }
    const state: NavState = { notice: `${v.year} ${v.name} ${v.model} (${v.stockNumber}) was deleted.` };
    navigate(backTo, { replace: true, state });
  };

  if (confirming) {
    return (
      <div className="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
        <p id="confirm-title" className="confirm-title">Delete this vehicle?</p>
        <p id="confirm-desc">
          {v.year} {v.name} {v.model} ({v.stockNumber}) and its photos will be removed from inventory. This can't be undone.
        </p>
        {deleteError && <p className="field-error" role="alert">{deleteError}</p>}
        <div className="form-actions">
          <button type="button" className="button button-danger" onClick={onDelete} disabled={deleting} autoFocus>
            {deleting ? 'Deleting…' : 'Delete vehicle'}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={deleting}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-actions">
      <Link to={`/vehicles/${v.id}/edit`} state={{ from: backTo } satisfies NavState} className="button">
        Edit
      </Link>
      <button type="button" className="button button-danger-outline" onClick={() => setConfirming(true)}>
        Delete
      </button>
    </div>
  );
}
