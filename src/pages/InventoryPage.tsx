import { useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { fetchVehicles, useRemote } from '../api';
import { useAuth } from '../auth';
import { CATEGORIES, type Category, type Vehicle } from '../types';
import { VehicleCard } from '../components/VehicleCard';
import { VehicleTable } from '../components/VehicleTable';
import { RemoteStatus } from '../components/RemoteStatus';
import { formatPrice } from '../format';

type SortKey = 'price-asc' | 'price-desc' | 'year-desc' | 'year-asc' | 'name-asc';
type View = 'grid' | 'table';

const SORT_KEYS: SortKey[] = ['price-asc', 'price-desc', 'year-desc', 'year-asc', 'name-asc'];

const PRICE_FLOOR = 20000;

// Filter bounds come from the inventory itself, so the year and price controls cover every vehicle.
function inventoryBounds(vehicles: Vehicle[]) {
  if (vehicles.length === 0) {
    const year = new Date().getFullYear();
    return { minYear: year, maxYear: year, maxPrice: PRICE_FLOOR };
  }
  const years = vehicles.map((v) => v.year);
  return {
    minYear: Math.min(...years),
    maxYear: Math.max(...years),
    maxPrice: Math.max(PRICE_FLOOR, Math.ceil(Math.max(...vehicles.map((v) => v.price)) / 5000) * 5000),
  };
}

type ParamKey = 'cat' | 'q' | 'minYear' | 'maxPrice' | 'sort' | 'view';

export function InventoryPage() {
  const remote = useRemote('all', (signal) => fetchVehicles({}, signal));

  useEffect(() => {
    document.title = 'Vehicle Inventory';
  }, []);

  return remote.status === 'ready' ? (
    <Inventory vehicles={remote.data} />
  ) : (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◆</span>
          <div>
            <h1>Vehicle Inventory</h1>
            <p>Dealership stock available for sale</p>
          </div>
        </div>
      </header>
      <RemoteStatus remote={remote} what="inventory" />
    </>
  );
}

function Inventory({ vehicles }: { vehicles: Vehicle[] }) {
  const bounds = useMemo(() => inventoryBounds(vehicles), [vehicles]);

  // Filters live in the URL query string so they survive navigating to a detail page and back,
  // and so a filtered view can be bookmarked or shared. Default values are omitted from the URL.
  const DEFAULTS: Record<ParamKey, string> = {
    cat: 'All',
    q: '',
    minYear: String(bounds.minYear),
    maxPrice: String(bounds.maxPrice),
    sort: 'price-asc',
    view: 'grid',
  };

  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const get = (k: ParamKey) => params.get(k) ?? DEFAULTS[k];

  const rawCat = get('cat');
  const category: Category | 'All' = (CATEGORIES as readonly string[]).includes(rawCat) ? (rawCat as Category) : 'All';
  const search = get('q');
  const minYear = Number(get('minYear')) || bounds.minYear;
  const maxPrice = Number(get('maxPrice')) || bounds.maxPrice;
  const sort: SortKey = SORT_KEYS.includes(get('sort') as SortKey) ? (get('sort') as SortKey) : 'price-asc';
  const view: View = get('view') === 'table' ? 'table' : 'grid';

  const set = (k: ParamKey, value: string | number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (String(value) === DEFAULTS[k]) next.delete(k);
        else next.set(k, String(value));
        return next;
      },
      { replace: true },
    );

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: vehicles.length };
    for (const v of vehicles) c[v.category] = (c[v.category] ?? 0) + 1;
    return c;
  }, [vehicles]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = vehicles.filter(
      (v) =>
        (category === 'All' || v.category === category) &&
        v.year >= minYear &&
        v.price <= maxPrice &&
        (!q || `${v.name} ${v.model} ${v.year} ${v.stockNumber}`.toLowerCase().includes(q)),
    );
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'price-asc': return a.price - b.price;
        case 'price-desc': return b.price - a.price;
        case 'year-desc': return b.year - a.year;
        case 'year-asc': return a.year - b.year;
        case 'name-asc': return `${a.name} ${a.model}`.localeCompare(`${b.name} ${b.model}`);
      }
    });
    return sorted;
  }, [vehicles, category, search, minYear, maxPrice, sort]);

  const resetFilters = () =>
    setParams((prev) => {
      const next = new URLSearchParams();
      // Keep presentation preferences, drop filters.
      for (const k of ['sort', 'view'] as const) if (prev.has(k)) next.set(k, prev.get(k)!);
      return next;
    }, { replace: true });

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◆</span>
          <div>
            <h1>Vehicle Inventory</h1>
            <p>Dealership stock available for sale</p>
          </div>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search name, model, year or stock #"
          value={search}
          onChange={(e) => set('q', e.target.value)}
        />
        {isAdmin && (
          <Link to="/vehicles/new" state={{ from: location.pathname + location.search }} className="button add-button">
            + Add vehicle
          </Link>
        )}
      </header>

      <nav className="tabs" aria-label="Vehicle categories">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            className={c === category ? 'tab active' : 'tab'}
            onClick={() => set('cat', c)}
          >
            {c}
            <span className="count">{counts[c] ?? 0}</span>
          </button>
        ))}
      </nav>

      <section className="toolbar">
        <label>
          Min year
          <select value={minYear} onChange={(e) => set('minYear', e.target.value)}>
            {Array.from({ length: bounds.maxYear - bounds.minYear + 1 }, (_, i) => bounds.minYear + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="range">
          Max price <strong>{formatPrice(maxPrice)}</strong>
          <input
            type="range"
            min={PRICE_FLOOR}
            max={bounds.maxPrice}
            step={1000}
            value={maxPrice}
            onChange={(e) => set('maxPrice', e.target.value)}
          />
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="year-desc">Year: newest</option>
            <option value="year-asc">Year: oldest</option>
            <option value="name-asc">Name: A–Z</option>
          </select>
        </label>
        <div className="view-toggle" role="group" aria-label="View">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => set('view', 'grid')}>Grid</button>
          <button className={view === 'table' ? 'active' : ''} onClick={() => set('view', 'table')}>Table</button>
        </div>
      </section>

      <p className="summary">
        Showing <strong>{results.length}</strong> of {vehicles.length} vehicles
      </p>

      {results.length === 0 ? (
        <div className="empty">
          <p>No vehicles match these filters.</p>
          <button onClick={resetFilters}>Reset filters</button>
        </div>
      ) : view === 'grid' ? (
        <div className="grid">
          {results.map((v) => <VehicleCard key={v.id} vehicle={v} />)}
        </div>
      ) : (
        <VehicleTable vehicles={results} />
      )}
    </>
  );
}
