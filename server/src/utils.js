import { z } from 'zod';

/** Erreur "attendue" : son message est sûr à renvoyer au client. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Requête invalide.', details) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Connexion requise.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Action non autorisée.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Ressource introuvable.') => new AppError(404, 'not_found', message);
export const conflict = (message = 'Conflit avec une ressource existante.') => new AppError(409, 'conflict', message);
export const upstream = (message = 'Le service de films est momentanément indisponible.') =>
  new AppError(502, 'upstream_error', message);

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{3,30}$/, '3 à 30 caractères : lettres, chiffres, _ ou -.');

const email = z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(254);

// bcrypt ne lit que 72 octets : on plafonne pour éviter une fausse impression de sécurité.
const password = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères.')
  .max(72, 'Le mot de passe ne doit pas dépasser 72 caractères.');

const avatarUrl = z
  .string()
  .trim()
  .max(500)
  .url('URL invalide.')
  .refine((u) => u.startsWith('https://'), 'Seules les URL https:// sont acceptées.');

const tmdbId = z.coerce.number().int().positive().max(2_000_000_000);
const page = z.coerce.number().int().min(1).max(500).default(1);
const sort = z.enum(['popularity', 'rating', 'date', 'title']).default('popularity');

export const schemas = {
  register: z.object({ username, email, password }).strict(),
  login: z.object({ email, password: z.string().min(1).max(72) }).strict(),
  profileUpdate: z
    .object({ username: username.optional(), avatarUrl: z.union([avatarUrl, z.literal('')]).optional() })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Aucune modification fournie.'),
  movieParam: z.object({ id: tmdbId }),
  movieIdParam: z.object({ movieId: tmdbId }),
  idParam: z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  movieBody: z.object({ movieId: tmdbId }).strict(),
  pageQuery: z.object({ page }),
  discoverQuery: z.object({
    page,
    genre: tmdbId.optional(),
    year: z.coerce.number().int().min(1888).max(2100).optional(),
    sort,
  }),
  searchQuery: z.object({
    q: z.string().trim().min(1, 'Saisis au moins un caractère.').max(100),
    page,
    genre: tmdbId.optional(),
    year: z.coerce.number().int().min(1888).max(2100).optional(),
    sort,
  }),
  reviewBody: z
    .object({
      rating: z.coerce.number().int().min(1, 'Note entre 1 et 10.').max(10, 'Note entre 1 et 10.'),
      comment: z.string().trim().max(2000, '2000 caractères maximum.').optional().nullable(),
    })
    .strict(),
};

/** Valide une source (body, query, params) et renvoie les données typées, ou lève une AppError 400. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest('Certaines informations sont invalides.', fields);
}
