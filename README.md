# 🎬 Cinéthèque — catalogue de films

Application web de **découverte de films** (recherche, fiches détaillées, favoris, liste « À voir », films vus, avis).
**Aucun streaming** : c'est un catalogue.

**Stack** : React + Vite · Node.js/Express (API REST) · PostgreSQL (Docker ou Neon) · API TMDB · nginx · Docker Compose.

```text
Navigateur ─► nginx (React) ─► /api ─► Express ─┬─► PostgreSQL (cache persistant + comptes + listes)
                                                └─► API TMDB (clé uniquement côté serveur)
```

Le navigateur ne parle jamais à PostgreSQL ni à TMDB directement.

## Démarrage rapide (Docker)

```bash
cp .env.example .env      # puis renseigne API_KEY, JWT_SECRET, POSTGRES_PASSWORD
docker compose up --build
```

Ouvre **http://localhost:8080**. Les migrations s'appliquent automatiquement au démarrage de l'API.

- Clé TMDB gratuite : https://www.themoviedb.org/settings/api (clé v3 ou jeton v4, les deux fonctionnent).
- `JWT_SECRET` : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- En HTTP local le cookie de session n'est pas `Secure` (`COOKIE_SECURE=false` par défaut dans le compose). **Mets `COOKIE_SECURE=true` derrière HTTPS.**

### Utiliser Neon à la place de la base locale
1. Crée un projet sur https://neon.tech et copie l'URL de connexion **pooled** (`sslmode=require`).
2. Dans `.env`, décommente `DATABASE_URL=...` : elle remplace automatiquement la base Docker.
3. (Facultatif) retire le service `db` de `docker-compose.yml`.

## Développement sans Docker

```bash
# terminal 1 — API (Node ≥ 20, PostgreSQL accessible via DATABASE_URL dans .env)
cd server && npm install && npm run dev      # http://localhost:4000

# terminal 2 — front (le proxy Vite relaie /api vers :4000)
cd client && npm install && npm run dev      # http://localhost:5173
```

Variables pour ce mode (dans `.env`) : `DATABASE_URL`, `CLIENT_ORIGIN=http://localhost:5173`, `NODE_ENV=development`.

## Structure

```text
cineapp/
├── .env.example · docker-compose.yml · README.md
├── server/
│   ├── Dockerfile · package.json
│   ├── src/
│   │   ├── index.js              Config, Express, erreurs, démarrage (+ migrations)
│   │   ├── db.js                 Pool PostgreSQL + migrations 001→012 versionnées
│   │   ├── utils.js              Erreurs applicatives, validation (zod)
│   │   ├── middleware/auth.js    Session JWT (cookie httpOnly), CORS, CSRF, rate limiting
│   │   ├── services/tmdb.js      Client TMDB + synchronisation TMDB → PostgreSQL + recherche
│   │   └── routes/
│   │       ├── auth.js           Inscription, connexion, profil
│   │       ├── movies.js         Listes, fiche film, films similaires, recherche, genres
│   │       ├── lists.js          Favoris, À voir, Films vus, avis
│   │       └── searchHistory.js  Historique de recherche (20 max)
│   └── test/                     29 tests (unitaires + intégration PostgreSQL)
└── client/
    ├── Dockerfile · nginx.conf · package.json · vite.config.js · index.html
    └── src/
        ├── main.jsx · App.jsx · styles.css · utils.jsx
        ├── context/AuthContext.jsx   Session, notifications, état des listes (optimiste)
        ├── services/api.js           Client HTTP + services (films, listes, avis, auth)
        ├── components/               Navbar · MovieCard · MovieGrid
        └── pages/                    Home · Search · MovieDetails · MyLists (+ Profil) · Auth
```

## Base de données

Tables : `users`, `movies`, `genres`, `movie_genres`, `people`, `movie_cast`, `favorites`, `watchlist`, `reviews`, `watch_history`, `search_history` (+ `schema_migrations`).
Clés étrangères en cascade, contraintes `UNIQUE (user_id, movie_id)`, note `1 ≤ rating ≤ 10`, e-mail en minuscules, pseudo unique sans tenir compte de la casse, index trigramme pour la recherche de titres.

**Pour modifier le schéma** : ajoute une migration à la fin du tableau `MIGRATIONS` dans `server/src/db.js`. Ne modifie jamais une migration déjà appliquée.

**Cache TMDB → PostgreSQL** : à l'ouverture d'une fiche, le backend lit PostgreSQL ; s'il n'a pas le film (ou si la fiche a plus de 7 jours), il appelle TMDB, enregistre film + genres + distribution, puis répond. Si TMDB est indisponible, une fiche ancienne est servie plutôt qu'une erreur.
Les identifiants dans les URL (`/movie/:id`, `/api/favorites`…) sont les **identifiants TMDB**.

## API

| | |
|---|---|
| Auth | `POST /api/auth/register` · `login` · `logout` · `GET /api/auth/me` · `GET/PATCH /api/profile` |
| Films | `GET /api/movies` (filtres `genre`, `year`, `sort`, `page`) · `/popular` `/trending` `/top-rated` `/upcoming` `/now-playing` · `/:id` · `/:id/similar` |
| Recherche | `GET /api/search?q=…` · `GET/DELETE /api/search/history` |
| Genres | `GET /api/genres` · `GET /api/genres/:id/movies` |
| Listes 🔒 | `GET/POST /api/favorites` · `DELETE /api/favorites/:movieId` — idem `/api/watchlist` et `/api/watch-history` · `GET /api/library/ids` |
| Avis | `GET /api/movies/:id/reviews` · 🔒 `POST /api/movies/:id/reviews` · `GET /api/reviews/mine` · `PUT/DELETE /api/reviews/:id` |

Recherche : page 1 = PostgreSQL d'abord, complétée par TMDB si moins de 20 résultats locaux ; pages suivantes = TMDB.

## Sécurité (ce qui est en place)

- Mots de passe : bcrypt (coût 12). Connexion : message identique pour e-mail inconnu / mauvais mot de passe, temps de réponse équilibré.
- Session : JWT HS256 (algorithme imposé) dans un **cookie httpOnly**, `SameSite=Lax`, `Secure` en production — jamais dans `localStorage`. L'utilisateur est relu en base à chaque requête protégée.
- CSRF : les écritures exigent l'en-tête `X-Requested-With` (impossible à envoyer depuis un autre site sans CORS) + CORS limité à `CLIENT_ORIGIN`.
- Validation stricte (zod, champs inconnus refusés), requêtes SQL **toutes paramétrées**, recherche `LIKE` échappée.
- Autorisations : chaque ressource est filtrée par `user_id` (un avis d'autrui apparaît comme « introuvable »).
- Rate limiting (global, connexion, inscription, écritures), corps limité à 10 Ko, `helmet`, erreurs sans détail technique côté client.
- Clé TMDB et secrets uniquement côté serveur (`.env` ignoré par Git). Conteneur API non-root. CSP stricte dans nginx.
- Dépendances : lance `npm audit --omit=dev` dans `server/` et `client/` avant la mise en production.

Limites à connaître : pas de vérification d'e-mail ni de réinitialisation de mot de passe ; l'inscription révèle si un e-mail est déjà pris (choix d'ergonomie) ; le cache TMDB des listes est en mémoire (par instance).

## Tests

```bash
cd server && npm test                                   # unitaires (les tests d'intégration sont ignorés sans base)
TEST_DATABASE_URL=postgresql://… npm test               # + intégration (⚠️ base dédiée, jamais la production : branche Neon de test)
cd client && npm test                                   # utilitaires + rendu de l'application (API simulée)
```

## Déploiement

- **Docker** (VPS) : `docker compose up -d --build` derrière un reverse proxy HTTPS (Caddy, Traefik…), avec `COOKIE_SECURE=true`.
- **Netlify (front) + hébergeur Node (API) + Neon** : déploie `client/` sur Netlify avec la règle de proxy ci-dessous (cookie « même origine », pas de CORS), l'API sur Render/Railway/Fly avec les variables du `.env.example`.

  ```toml
  # netlify.toml (à la racine, base = "client")
  [[redirects]]
    from = "/api/*"
    to = "https://TON-API.example.com/api/:splat"
    status = 200
    force = true
  [[redirects]]
    from = "/*"
    to = "/index.html"
    status = 200
  ```

## Crédits

Données et images : [TMDB](https://www.themoviedb.org/). Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
