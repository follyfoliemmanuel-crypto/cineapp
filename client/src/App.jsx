import { Component, Suspense, lazy, useEffect } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Navbar, { Footer } from './components/Navbar.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { EmptyState } from './components/MovieGrid.jsx';
import { useDocumentTitle } from './utils.jsx';
import Home from './pages/Home.jsx';

export function Layout() {
  const { pathname } = useLocation();
  // Retour en haut à chaque changement de page, et focus sur le contenu pour les lecteurs d'écran
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <>
      <a className="skip-link" href="#main">Aller au contenu</a>
      <Navbar />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

/** Les pages privées redirigent vers /login (et y reviennent après connexion). */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="container page" aria-busy="true"><div className="skeleton skeleton--block" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function NotFound() {
  useDocumentTitle('Page introuvable');
  return (
    <div className="container page">
      <EmptyState icon="film" title="Cette page n’existe pas" actions={<Link to="/" className="btn btn--primary">Retour à l’accueil</Link>}>
        Le lien est peut-être incorrect ou la page a été déplacée.
      </EmptyState>
    </div>
  );
}

// Découpage du code : chaque page secondaire est chargée à la demande
const Search = lazy(() => import('./pages/Search.jsx'));
const Movie = lazy(() => import('./pages/MovieDetails.jsx'));
const MyLists = lazy(() => import('./pages/MyLists.jsx'));
const Profile = lazy(() => import('./pages/MyLists.jsx').then((m) => ({ default: m.Profile })));
const Login = lazy(() => import('./pages/Auth.jsx').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Auth.jsx').then((m) => ({ default: m.Register })));

class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Erreur d’affichage :', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container page">
        <div className="state state--error" role="alert">
          <h2>Quelque chose s’est mal passé</h2>
          <p>La page n’a pas pu s’afficher correctement.</p>
          <div className="actions"><button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Recharger la page</button></div>
        </div>
      </div>
    );
  }
}

const Fallback = () => <div className="container page" aria-busy="true"><div className="skeleton skeleton--block" /></div>;

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="movie/:id" element={<Movie />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route element={<ProtectedRoute />}>
              <Route path="favorites" element={<MyLists kind="favorites" />} />
              <Route path="watchlist" element={<MyLists kind="watchlist" />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
