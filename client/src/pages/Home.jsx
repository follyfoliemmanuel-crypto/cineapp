import { Link } from 'react-router-dom';
import { Icon, formatScore, formatYear, imageUrl, useAsync, useDocumentTitle, useGenres } from '../utils.jsx';
import { FilmActions } from '../components/MovieCard.jsx';
import { ErrorState, MovieRow } from '../components/MovieGrid.jsx';
import { movieService } from '../services/api.js';

export function HeroSkeleton() {
  return <div className="hero hero--skeleton" aria-busy="true" aria-label="Chargement du film à la une" />;
}

export function Hero({ movie }) {
  const { nameOf } = useGenres();
  const score = formatScore(movie.voteAverage);
  const year = formatYear(movie.releaseDate);
  const genres = movie.genreIds.map(nameOf).filter(Boolean).slice(0, 3);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__backdrop">
        <img
          src={imageUrl(movie.backdropPath, 'w1280')}
          srcSet={`${imageUrl(movie.backdropPath, 'w780')} 780w, ${imageUrl(movie.backdropPath, 'w1280')} 1280w`}
          sizes="100vw"
          alt=""
          width="1280"
          height="720"
          fetchpriority="high"
          decoding="async"
        />
      </div>
      <div className="container">
        <div className="hero__content">
          <p className="hero__eyebrow">À la une cette semaine</p>
          <h1 id="hero-title">{movie.title}</h1>
          <p className="hero__meta">
            {score && <span className="score" aria-label={`Note ${score} sur 10`}><Icon name="star" filled />{score}</span>}
            {year && <span className={score ? 'dot' : ''}>{year}</span>}
            {genres.length > 0 && <span className="dot">{genres.join(', ')}</span>}
          </p>
          {movie.overview && <p className="hero__overview">{movie.overview}</p>}
          <div className="hero__actions">
            <Link to={`/movie/${movie.id}`} className="btn btn--primary">Voir la fiche <Icon name="arrow" /></Link>
          </div>
          <FilmActions movieId={movie.id} />
        </div>
      </div>
    </section>
  );
}

const SECTIONS = [
  { id: 'popular', title: 'Films populaires', list: 'popular' },
  { id: 'top-rated', title: 'Mieux notés', list: 'top-rated' },
  { id: 'now-playing', title: 'Sorties récentes', list: 'now-playing' },
  { id: 'upcoming', title: 'Films à venir', list: 'upcoming' },
];

function Section({ id, title, list }) {
  const { data, error, loading, reload } = useAsync((signal) => movieService.list(list, 1, signal), [list]);
  return (
    <MovieRow headingId={`row-${id}`} title={title} to={`/search?list=${list}`} movies={data?.results ?? []} loading={loading} error={error} onRetry={reload} />
  );
}

export default function Home() {
  useDocumentTitle('');
  const trending = useAsync((signal) => movieService.list('trending', 1, signal), []);
  const { genres } = useGenres();

  const movies = trending.data?.results ?? [];
  const featured = movies.find((m) => m.backdropPath && m.overview) ?? movies.find((m) => m.backdropPath);

  return (
    <>
      {trending.loading ? <HeroSkeleton /> : featured ? <Hero movie={featured} /> : null}

      <div className="container">
        <div className="stack section">
          {trending.error ? (
            <ErrorState error={trending.error} onRetry={trending.reload} title="Le catalogue est momentanément indisponible" />
          ) : (
            <MovieRow headingId="row-trending" title="Tendances de la semaine" to="/search?list=trending" movies={movies.filter((m) => m.id !== featured?.id)} loading={trending.loading} />
          )}

          {SECTIONS.map((s) => <Section key={s.id} {...s} />)}

          {genres.length > 0 && (
            <section aria-labelledby="genres-title">
              <h2 id="genres-title" className="section__title">Parcourir par genre</h2>
              <nav className="genre-index" aria-label="Genres">
                {genres.map((g) => (
                  <Link key={g.id} to={`/search?genre=${g.id}`}>{g.name}<Icon name="right" /></Link>
                ))}
              </nav>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
