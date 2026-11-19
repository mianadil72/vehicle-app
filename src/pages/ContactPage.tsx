import { useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { fetchVehicle, useRemote } from '../api';
import { LeadForm } from '../components/LeadForm';
import { safePath, type NavState } from '../navigation';

/** `/contact` (public): ask for a salesperson to get in touch. `?vehicle=<id>` links the enquiry to that vehicle. */
export function ContactPage() {
  const [params] = useSearchParams();
  const from = (useLocation().state as NavState | null)?.from;
  const vehicleId = params.get('vehicle');
  const remote = useRemote(vehicleId ? `contact-vehicle-${vehicleId}` : null, (signal) => fetchVehicle(vehicleId!, signal));
  const vehicle = remote.status === 'ready' ? remote.data : null;

  useEffect(() => {
    document.title = 'Contact us | ONE-STOP VEHICLE SHOP DEALERSHIP';
  }, []);

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={safePath(from)}>← Back to inventory</Link>
      </nav>
      <div className="contact-page">
        {vehicleId && remote.status === 'loading' ? (
          <div className="empty" role="status"><p>Loading…</p></div>
        ) : (
          <LeadForm
            key={vehicle?.id ?? 'general'}
            source={vehicle ? 'vehicle' : 'contact'}
            vehicle={vehicle ? { id: vehicle.id, title: `${vehicle.year} ${vehicle.name} ${vehicle.model}`, condition: vehicle.condition } : undefined}
            heading={
              <>
                <h1>Talk to a salesperson</h1>
                <p className="login-sub">
                  Tell us what you're looking for and how to reach you. A member of our sales team will follow up.
                </p>
              </>
            }
          />
        )}
      </div>
    </>
  );
}
