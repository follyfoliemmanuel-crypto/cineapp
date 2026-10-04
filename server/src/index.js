import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import { closePool, runMigrations } from './db.js';
import { corsMiddleware, globalLimiter, requireCustomHeader, writeLimiter } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { listRoutes } from './routes/lists.js';
import { movieRoutes } from './routes/movies.js';
import { searchHistoryRoutes } from './routes/searchHistory.js';
import { createMovieService, createTmdbClient } from './services/tmdb.js';
import { AppError } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
// Charge le .env de la racine du projet (sans effet si l'hébergeur / Docker fournit déjà les variables)
dotenv.config({ path: path.resolve(path.dirname(__filename), '../../.env') });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('your_')) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

export function loadConfig({ requireAll = true } = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const jwtSecret = requireAll ? required('JWT_SECRET') : process.env.JWT_SECRET || '';
  if (requireAll && jwtSecret.length < 32) throw new Error('JWT_SECRET doit contenir au moins 32 caractères.');

  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('COOKIE_SAMESITE doit valoir lax, strict ou none.');

  // Cookie « Secure » : activé en production (HTTPS). Désactivable pour tester en HTTP local (Docker sur localhost).
  const secure = process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true' : isProduction || sameSite === 'none';

  return {
    isProduction,
    port: Number(process.env.PORT) || 4000,
    databaseUrl: requireAll ? required('DATABASE_URL') : process.env.DATABASE_URL || '',
    tmdb: {
      apiKey: requireAll ? required('API_KEY') : process.env.API_KEY || '',
      baseUrl: (process.env.API_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, ''),
    },
    jwtSecret,
    clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean),
    trustProxy: Number(process.env.TRUST_PROXY ?? 1),
    cookie: { name: 'ct_session', sameSite, secure, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  };
}

// ---------------------------------------------------------------------------
// Gestion des erreurs
// ---------------------------------------------------------------------------
const notFoundHandler = (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route introuvable.' } });

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { fields: err.details } : {}) } });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_request', message: 'Corps JSON invalide.' } });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Requête trop volumineuse.' } });
  // Erreur inattendue : détails dans les logs uniquement (jamais de SQL ni de stack côté client)
  console.error(`[erreur] ${req.method} ${req.path} :`, err.message);
  res.status(500).json({ error: { code: 'internal_error', message: 'Une erreur est survenue. Réessaie plus tard.' } });
}

// ---------------------------------------------------------------------------
// Application Express (dépendances injectables pour les tests)
// ---------------------------------------------------------------------------
export function createApp(config, { tmdb = createTmdbClient(config.tmdb), movies } = {}) {
  const app = express();
  const movieService = movies ?? createMovieService({ tmdb });
  const deps = { config, tmdb, movies: movieService };

  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(corsMiddleware(config.clientOrigins));
  app.use(globalLimiter);
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api', writeLimiter, requireCustomHeader, authRoutes(deps), movieRoutes(deps), searchHistoryRoutes(deps), listRoutes(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Démarrage (uniquement quand ce fichier est lancé directement)
// ---------------------------------------------------------------------------
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`Configuration invalide : ${err.message}`);
    process.exit(1);
  }

  try {
    const applied = await runMigrations();
    console.log(applied ? `${applied} migration(s) appliquée(s).` : 'Base de données à jour.');
  } catch (err) {
    console.error(`Base de données inaccessible ou migration échouée : ${err.message}`);
    process.exit(1);
  }

  const server = createApp(config).listen(config.port, () => {
    console.log(`API Cinéthèque prête sur le port ${config.port} (${config.isProduction ? 'production' : 'développement'})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} reçu, arrêt en cours…`);
    server.close(async () => { await closePool(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
