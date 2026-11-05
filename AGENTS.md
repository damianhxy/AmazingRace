# AmazingRace

Express 5 + Handlebars site for the Hwa Chong Science Week Amazing Race (2018 and 2019). Players
register, find puzzles around the campus and submit answers by question code (`AA01`) for stars;
a public leaderboard ranks them. Admins edit the problem set as JSON and can clear or delete
players. Users and sessions are in SQLite (better-sqlite3) under `database/`; the problems are
`database/questions.json`. The site is not deployed.

## Run and check

- Node: the version in `.node-version` (also the `engines` floor in `package.json`).
  `npm ci` builds better-sqlite3 with node-gyp, so it needs Python and `make` (slim Docker
  images lack them).
- `npm ci --engine-strict`, then copy `.env.example` to `.env` and set `SESSION_SECRET`
  (32+ random characters). Run `npm start` (or `npm run dev`) **from the repo root**.
- There is no admin sign-up: register, then set `admin = 1` for that user in
  `database/users.db`.
- **Gate** (what CI runs; all must pass before a PR is ready):

  ```sh
  npm ci --engine-strict && npm run lint && npm run format:check && npm test && npm audit --omit=dev
  ```

- `npm test` boots the real `node app.js` in a temporary copy of the repo (your `database/` is
  never touched) with a fixed problem set, and drives it over HTTP with a cookie-jar client that
  scrapes the CSRF token (`test/helpers/app.js`). No network is needed.

## Where things live

- `app.js`: startup and the secret check.
- `controllers/config.js`: middleware (helmet, sessions, passport strategies, CSRF).
- `controllers/routes.js`: top-level routes and the 404/500 handlers; `users.js`, `submit.js`
  and `admin.js` beside it. `controllers/settings.js`: port, secret, bcrypt rounds.
- `models/user.js` (SQLite: accounts, scores, leaderboard order), `models/problem.js`
  (`questions.json`: loading, answer checks, admin updates).
- `middlewares/`: auth, admin, flash messages. `views/`: Handlebars templates. `public/`: static.
- `test/`: `node:test` suites; `test/helpers/app.js` is the harness.
- `.github/workflows/ci.yml`: checks `test (floor)`, `test (lts)` and `audit` on every PR and
  push to `master`, weekly on Mondays; a failing scheduled run opens a "Scheduled CI failed"
  issue. `dependabot.yml`: monthly grouped updates. `dependabot-auto-merge.yml`: patch and minor
  Dependabot PRs merge themselves once the required checks pass.

## Conventions

- Damian merges. Agents work on branches and open or update PRs; they never merge, close PRs,
  push to `master` or change repository settings.
- One problem per commit, one theme per PR. Imperative, sentence-case subjects with no prefix,
  except dependency commits: `fix(deps): update <pkg> <old> -> <new> (GHSA-…)`.
- Commit bodies say what was wrong (citing the commit that caused it), the fix, and how it was
  verified: the result before and after. A behavioural fix adds a test that fails before it.
- Don't force-push a pushed branch; add commits, and merge the base in to update it.
- Stacked PRs say so in the description and give the merge order.
- Known gaps are `test.todo` entries named after the item they miss. Fixing one means dropping
  `.todo` in the same PR.
- The CSRF form field is `csrfToken`.

## Decided against (don't re-propose)

- npm's audit "fix" for the dev-only eslint/minimatch advisory.
- Migrating old NeDB data into SQLite. There is no data worth migrating.
- Renaming the `csrfToken` form field to `_csrf`.
- Turning on a strict Content-Security-Policy as a side effect of another fix. It needs its
  own PR, after the inline admin-page script moves into a file.

## Known issues (don't re-investigate)

- `database/sessions.db`, `public/` and `views/` are opened relative to the working directory,
  so the app only starts from the repo root.
- The secret check refuses only a missing secret and one old placeholder: a short secret, or
  the `.env.example` placeholder, starts the app (open PR #1).
- The CSRF token is accepted in the query string and refused in an `X-CSRF-Token` header, and
  a CSRF failure shows Express's stack-trace page outside production (open PR #1).
- Sign-out is a GET link and leaves the stored session in place (open PR #1).
- With `NODE_ENV=production` the session cookie is `Secure` but `trust proxy` is never set, so
  behind an HTTPS proxy no cookie is issued and every form fails CSRF; the rate limits are
  shared by everyone behind the proxy (open PR #6, which still crashes at startup on
  `TRUST_PROXY=true` or `false`).
- A case-insensitive problem configured with a capital letter can never be solved; question
  codes are used as typed (`aa01` is "Category does not exist"); admin updates accept any JSON
  shape (open PR #2).
- Sign-in says "User does not exist" or "Wrong password", so it reveals which usernames exist.
- The admin editor's ace `basePath` (`/js/ace`) 404s, so the JSON editor has no highlighting.
- `res.status(4xx).redirect(...)` calls send 302 (redirect overrides the status). Don't add
  more.
