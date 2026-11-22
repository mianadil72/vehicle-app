import { useEffect, useRef, useState } from 'react';
import { PHONE_QUERY, useMediaQuery } from '../media';
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
import { LeadForm } from '../components/LeadForm';

export function VehicleDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { isAdmin, isSalesTeam } = useAuth();
  const [interestedIn, setInterestedIn] = useState<string | null>(null);
  const interested = interestedIn !== null && interestedIn === id;
  const setInterested = (open: boolean) => setInterestedIn(open ? (id ?? null) : null);
  const showInterest = () => {
    setInterested(true);
    requestAnimationFrame(() => {
      const form = document.getElementById('interested');
      form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    });
  };

  // Phones: once the summary's "I'm interested" button scrolls off screen, show a sticky bottom bar.
  const phone = useMediaQuery(PHONE_QUERY);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [ctaOnScreen, setCtaOnScreen] = useState(true);

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

  const vehicleId = vehicle?.id;
  useEffect(() => {
    if (!phone || !vehicleId) return;
    // A scroll listener (not IntersectionObserver) so big jumps, like tapping the status bar or a restored
    // scroll position, are handled too. Visible = the button hasn't scrolled off the top.
    const pending = { frame: 0 };
    const check = () => {
      pending.frame = 0;
      const el = ctaRef.current;
      if (el) setCtaOnScreen(el.getBoundingClientRect().bottom > 0);
    };
    const schedule = () => {
      if (!pending.frame) pending.frame = requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(pending.frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [vehicleId, phone]);

  useEffect(() => {
    if (pending) return;
    document.title = vehicle
      ? `${vehicle.year} ${vehicle.name} ${vehicle.model} | ONE-STOP VEHICLE SHOP DEALERSHIP`
      : 'Vehicle not found | ONE-STOP VEHICLE SHOP DEALERSHIP';
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
  const forSale = !v.saleStatus;

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
            {v.saleStatus === 'Sold' && <span className="pill sale-sold">Sold</span>}
            {v.saleStatus === 'SalePending' && <span className="pill sale-pending">Sale pending</span>}
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
          {forSale ? (
            <div className="detail-actions" ref={ctaRef}>
              <button type="button" className="button interested-button" onClick={showInterest} aria-expanded={interested} aria-controls="interested">
                I'm interested
              </button>
              {isSalesTeam && (
                <Link to={`/sales/new?vehicle=${v.id}`} className="button button-secondary">Record sale</Link>
              )}
            </div>
          ) : (
            <p className="detail-actions field-hint">
              {v.saleStatus === 'Sold' ? 'This vehicle has been sold.' : 'A sale for this vehicle is waiting for approval.'}
            </p>
          )}
        </aside>
      </div>

      {forSale && phone && !ctaOnScreen && !interested && (
        <div className="sticky-cta">
          <div className="sticky-cta-text">
            <span className="sticky-cta-title">{v.year} {v.name} {v.model}</span>
            <strong>{formatPrice(v.price)}</strong>
          </div>
          <button type="button" className="button" onClick={showInterest}>I'm interested</button>
        </div>
      )}

      {interested && (
        <section className="interested" id="interested" aria-label="Contact a salesperson about this vehicle">
          <LeadForm
            key={v.id}
            source="vehicle"
            vehicle={{ id: v.id, title: `${v.year} ${v.name} ${v.model}`, condition: v.condition }}
            heading={<h2>I'm interested in this vehicle</h2>}
          />
        </section>
      )}

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
