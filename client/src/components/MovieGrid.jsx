import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../utils.jsx';
import MovieCard from './MovieCard.jsx';

export function CardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton skeleton--poster" />
      <div className="skeleton skeleton--line" />
      <div className="skeleton skeleton--line short" />
    </div>
  );
}

export function GridSkeleton({ count = 12 }) {
  return (
    <div className="movie-grid" aria-busy="true" aria-label="Chargement des films">
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

export function RowSkeleton({ count = 8 }) {
  return (
    <div className="row__scroller" aria-busy="true" aria-label="Chargement des films">
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

/** Vide : dit ce qui est vide, pourquoi, et ce que l'on peut faire ensuite. */
export function EmptyState({ icon = 'film', title, children, actions }) {
  return (
    <div className="state">
      <Icon name={icon} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Impossible de charger cette page' }) {
  return (
    <div className="state state--error" role="alert">
      <Icon name="alert" />
      <h2>{title}</h2>
      <p>{error?.message ?? 'Une erreur est survenue.'}</p>
      {onRetry && (
        <div className="actions">
          <button type="button" className="btn btn--secondary" onClick={onRetry}>Réessayer</button>
        </div>
      )}
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Icon name="left" /> Précédent
      </button>
      <span aria-live="polite">Page {page} sur {totalPages}</span>
      <button type="button" className="btn btn--secondary btn--sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Suivant <Icon name="right" />
      </button>
    </nav>
  );
}

/** Rangée horizontale d'affiches (défilement tactile + boutons sur ordinateur). */
export function MovieRow({ title, headingId, to, movies, loading, error, onRetry }) {
  const scroller = useRef(null);
  const scrollBy = (dir) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className="row" aria-labelledby={headingId}>
      <div className="row__head">
        <h2 id={headingId}>{title}</h2>
        {to && <Link to={to}>Tout voir</Link>}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} title="Cette sélection n’a pas pu être chargée" />
      ) : loading ? (
        <RowSkeleton />
      ) : (
        <>
          <div className="row__nav">
            <button type="button" className="icon-btn" onClick={() => scrollBy(-1)} aria-label={`${title} : précédent`}><Icon name="left" /></button>
            <button type="button" className="icon-btn" onClick={() => scrollBy(1)} aria-label={`${title} : suivant`}><Icon name="right" /></button>
          </div>
          <div className="row__scroller" ref={scroller} role="list">
            {movies.map((m) => (
              <div role="listitem" key={m.id}><MovieCard movie={m} /></div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function MovieGrid({ movies }) {
  return (
    <div className="movie-grid">
      {movies.map((m) => <MovieCard key={m.id} movie={m} />)}
    </div>
  );
}
