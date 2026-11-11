import { useState, type FormEvent } from 'react';
import { ApiError, addComment, deleteComment, fetchComments, useRemote } from '../api';
import { authErrorMessage, useAuth } from '../auth';
import { formatDateTime } from '../format';
import { COMMENT_MAX_LENGTH, type VehicleComment } from '../types';
import { RemoteStatus } from './RemoteStatus';

/**
 * Comments/reviews on a vehicle: everyone can read them, only admins can add or delete them.
 * Render with `key={vehicle.id}` so the local state resets when switching vehicles.
 */
export function VehicleComments({ vehicleId }: { vehicleId: string }) {
  const auth = useAuth();
  const remote = useRemote(`comments-${vehicleId}`, (signal) => fetchComments(vehicleId, signal));
  // Changes made on this page, layered over the loaded list so it doesn't reload after each one.
  const [added, setAdded] = useState<VehicleComment[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  const comments =
    remote.status === 'ready' ? [...added, ...remote.data].filter((c) => !removed.has(c.id)) : [];

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h2 id="comments-title">
        Comments {remote.status === 'ready' && <span className="count">{comments.length}</span>}
      </h2>

      {auth.isAdmin && <CommentForm vehicleId={vehicleId} onAdded={(c) => setAdded((list) => [c, ...list])} />}

      {remote.status !== 'ready' ? (
        <RemoteStatus remote={remote} what="comments" />
      ) : comments.length === 0 ? (
        <p className="comments-empty">No comments yet.</p>
      ) : (
        <ol className="comment-list">
          {comments.map((c) => (
            <Comment
              key={c.id}
              comment={c}
              canDelete={auth.isAdmin}
              onDeleted={() => setRemoved((set) => new Set(set).add(c.id))}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function CommentForm({ vehicleId, onAdded }: { vehicleId: string; onAdded: (c: VehicleComment) => void }) {
  const auth = useAuth();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const length = body.trim().length;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (length === 0) {
      setError('Write a comment first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onAdded(await addComment(vehicleId, body));
      setBody('');
    } catch (err) {
      const authProblem = authErrorMessage(err);
      if (authProblem) auth.refresh(); // The form disappears if the session ended.
      setError(authProblem ?? (err instanceof Error && err.message ? err.message : "Couldn't add the comment."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comment-form" onSubmit={onSubmit} noValidate>
      <label htmlFor="comment-body" className="visually-hidden">Add a comment</label>
      <textarea
        id="comment-body"
        rows={3}
        placeholder="Add a review or note about this vehicle…"
        value={body}
        maxLength={COMMENT_MAX_LENGTH}
        onChange={(e) => {
          setBody(e.target.value);
          if (error) setError(null);
        }}
        disabled={saving}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'comment-error' : 'comment-count'}
      />
      <div className="comment-form-row">
        {error ? (
          <p className="field-error" id="comment-error" role="alert">{error}</p>
        ) : (
          <p className="field-hint" id="comment-count">
            {length.toLocaleString('en-US')} / {COMMENT_MAX_LENGTH.toLocaleString('en-US')}
          </p>
        )}
        <button type="submit" className="button" disabled={saving || length === 0}>
          {saving ? 'Adding…' : 'Add comment'}
        </button>
      </div>
    </form>
  );
}

function Comment({ comment: c, canDelete, onDeleted }: { comment: VehicleComment; canDelete: boolean; onDeleted: () => void }) {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteComment(c.vehicleId, c.id);
      onDeleted();
    } catch (err) {
      setDeleting(false);
      const authProblem = authErrorMessage(err);
      if (authProblem) auth.refresh();
      // 404: already deleted elsewhere, so just drop it from the list.
      if (!authProblem && err instanceof ApiError && err.status === 404) onDeleted();
      else setError(authProblem ?? "Couldn't delete the comment.");
    }
  };

  return (
    <li className="comment">
      <div className="comment-meta">
        <strong>{c.author}</strong>
        <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
        {canDelete &&
          (confirming ? (
            <span className="comment-confirm">
              Delete this comment?
              <button type="button" className="link-danger" onClick={onDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className="account-link" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="link-danger comment-delete" onClick={() => setConfirming(true)}>
              Delete
            </button>
          ))}
      </div>
      <p className="comment-body">{c.body}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  );
}
