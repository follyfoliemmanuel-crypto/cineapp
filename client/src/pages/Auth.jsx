import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useToast } from '../context/AuthContext.jsx';
import { useDocumentTitle } from '../utils.jsx';

function Field({ id, label, error, hint, ...props }) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="error-text" id={`${id}-error`}>{error}</span>}
    </div>
  );
}

function useRedirectTarget() {
  const location = useLocation();
  const from = location.state?.from;
  // Seuls les chemins internes sont acceptés (pas de redirection ouverte)
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function Login() {
  useDocumentTitle('Connexion');
  const { user, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !busy) return <Navigate to={target} replace />;

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Saisis une adresse e-mail valide.';
    if (!form.password) next.password = 'Saisis ton mot de passe.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const u = await login({ email: form.email.trim(), password: form.password });
      toast.success(`Bon retour, ${u.username} !`);
      navigate(target, { replace: true });
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container auth">
      <div className="auth__panel">
        <div>
          <h1>Connexion</h1>
          <p className="lead">Retrouve tes favoris, ta liste « À voir » et tes avis.</p>
        </div>
        <form onSubmit={submit} noValidate>
          {formError && <p className="banner" role="alert">{formError}</p>}
          <Field id="email" label="Adresse e-mail" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field id="password" label="Mot de passe" type="password" autoComplete="current-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="submit" className="btn btn--primary" aria-busy={busy} disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        </form>
        <p className="auth__alt">Pas encore de compte ? <Link to="/register" state={{ from: target }}>Créer un compte</Link></p>
      </div>
    </div>
  );
}

export function Register() {
  useDocumentTitle('Créer un compte');
  const { user, register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !busy) return <Navigate to={target} replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(form.username.trim())) next.username = '3 à 30 caractères : lettres, chiffres, _ ou -.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Saisis une adresse e-mail valide.';
    if (form.password.length < 10) next.password = 'Au moins 10 caractères.';
    else if (form.password.length > 72) next.password = '72 caractères maximum.';
    if (form.confirm !== form.password) next.confirm = 'Les mots de passe ne correspondent pas.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const u = await register({ username: form.username.trim(), email: form.email.trim(), password: form.password });
      toast.success(`Bienvenue, ${u.username} !`);
      navigate(target, { replace: true });
    } catch (err) {
      setErrors(err.fields ?? {});
      setFormError(err.fields ? '' : err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container auth">
      <div className="auth__panel">
        <div>
          <h1>Créer un compte</h1>
          <p className="lead">Gratuit. Il suffit d’un e-mail pour garder tes listes et publier des avis.</p>
        </div>
        <form onSubmit={submit} noValidate>
          {formError && <p className="banner" role="alert">{formError}</p>}
          <Field id="username" label="Nom d’utilisateur" autoComplete="username" value={form.username} error={errors.username} onChange={set('username')} />
          <Field id="email" label="Adresse e-mail" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={set('email')} />
          <Field id="password" label="Mot de passe" type="password" autoComplete="new-password" hint="10 caractères minimum. Une phrase de passe fonctionne très bien." value={form.password} error={errors.password} onChange={set('password')} />
          <Field id="confirm" label="Confirmer le mot de passe" type="password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={set('confirm')} />
          <button type="submit" className="btn btn--primary" aria-busy={busy} disabled={busy}>{busy ? 'Création…' : 'Créer mon compte'}</button>
        </form>
        <p className="auth__alt">Déjà inscrit ? <Link to="/login">Se connecter</Link></p>
      </div>
    </div>
  );
}
