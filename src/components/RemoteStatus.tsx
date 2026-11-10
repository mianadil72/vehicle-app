import type { Remote } from '../api';

/** Loading / error placeholder for data that hasn't arrived yet. Renders nothing once ready. */
export function RemoteStatus({ remote, what }: { remote: Remote<unknown>; what: string }) {
  if (remote.status === 'loading') {
    return (
      <div className="empty" role="status">
        <p>Loading {what}…</p>
      </div>
    );
  }
  if (remote.status === 'error') {
    return (
      <div className="empty" role="alert">
        <p>Couldn't load {what}. Check that the API server and database are running.</p>
        <button onClick={remote.retry}>Try again</button>
      </div>
    );
  }
  return null;
}
