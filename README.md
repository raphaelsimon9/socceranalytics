# MatchLab Analytics

A responsive football and NBA statistics application with a React dashboard, Express API, persistent local snapshots, transparent score estimates, and historical model evaluation. The default theme is light; dark mode is available from the header. The interface adapts to desktop, tablet, and mobile browsers.

**Scope:** MatchLab is a sports-statistics and educational model-evaluation tool. It does not connect to bookmakers, ingest bookmaker odds, recommend wagers, or produce betting selections.

## Included in this build

- Football fixtures, completed results, competition filters, and match scores from football-data.org v4.
- NBA teams and games from BALLDONTLIE's NBA API.
- Configurable date ranges, team search, and fixture/result selection.
- Football 1X2 probability estimates from a recent-form Poisson baseline, plus descriptive total-goals distributions for 1.5, 2.5, 3.5, and 4.5 lines.
- NBA home/away win probability estimates and total-points distributions from a recent points/points-allowed baseline.
- Expected score/points summaries, sample-size indicators, and model limitations.
- Persistent JSON snapshots stored on the API server (no database server required for a single-instance deployment).
- Historical evaluation view with accuracy, Brier score, log loss, calibration bins, and a sample of evaluated records.
- API health and configuration endpoints, timeout handling, provider error messages, request caching, and basic automated model tests.
- Responsive light/dark interface and a Docker image that can serve both frontend and API from one origin.

## Requirements

- Node.js 20 or newer and npm.
- A football-data.org API token for football data.
- A BALLDONTLIE API key for NBA data. Access to historical records, endpoints, and rate limits depends on your account plan.

Official provider documentation:
- [football-data.org quickstart](https://www.football-data.org/documentation/quickstart)
- [BALLDONTLIE documentation](https://docs.balldontlie.io/)

## Run locally

1. Extract the project and open a terminal in the project folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create the server environment file:

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example server/.env
   ```

   **macOS/Linux**
   ```bash
   cp .env.example server/.env
   ```

4. Edit `server/.env` and set your keys:

   ```dotenv
   PORT=4000
   CLIENT_ORIGIN=http://localhost:5173
   FOOTBALL_DATA_API_KEY=your_football_data_token
   BALLDONTLIE_API_KEY=your_balldontlie_key
   SERVE_CLIENT=false
   ```

   Never place provider secrets in `client/.env`, `VITE_*` variables, or frontend code.

5. Start both services:

   ```bash
   npm run dev
   ```

6. Open the Vite URL printed in the terminal (usually `http://localhost:5173`). The API health endpoint is `http://localhost:4000/api/health`.

If you only configure one provider, that sport works and the other shows a setup message. Do not use a placeholder key as a real credential.

## Suggested workflow

1. Choose Football or Basketball and set a date range in Match centre.
2. Select **Apply dates** to load fixtures and results from the provider.
3. Select a match to inspect its estimated outcome probabilities and expected score.
4. Select **Import historical data** to save completed results locally. Football history is requested for a bounded time window; the NBA history request is constrained by provider endpoint and account access.
5. Open **Model evaluation** and run the backtest after you have imported enough historical records.
6. Review the sample size, accuracy, Brier score, log loss, and calibration bins. A model should not be considered reliable from one small sample.

Snapshots are written to `server/data/matchlab-store.json` by default. The store is designed for a single application instance; for multiple instances, use a shared database or persistent storage service instead.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Service, provider configuration, and local-store status |
| GET | `/api/config` | Enabled providers and features |
| GET | `/api/football/competitions` | Competition list |
| GET | `/api/football/matches?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` | Football fixtures/results |
| GET | `/api/football/history?days=180` | Import completed football results into local snapshots |
| GET | `/api/football/forecast/:matchId` | Football probability and expected-score estimate |
| GET | `/api/basketball/teams` | NBA team list |
| GET | `/api/basketball/games?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` | NBA games and scores |
| GET | `/api/basketball/history?season=2025` | Import completed NBA games for a season where accessible |
| GET | `/api/basketball/forecast/:gameId` | NBA probability and expected-score estimate |
| GET | `/api/analytics/summary` | Local snapshot counts |
| GET | `/api/analytics/backtest?sport=football` | Historical evaluation metrics |

## Deploy with Docker

The Docker image builds the React app and serves it from Express, so only one web service is needed.

1. Push this project to a Git repository.
2. Create a Docker-based web service from the repository, or deploy it using the included `render.yaml` blueprint.
3. Set these environment variables in your host dashboard:
   - `SERVE_CLIENT=true`
   - `PORT=4000`
   - `FOOTBALL_DATA_API_KEY` (secret)
   - `BALLDONTLIE_API_KEY` (secret)
   - `DATA_STORE_PATH=/var/data/matchlab-store.json` if you mount a persistent disk at `/var/data`.
4. Attach persistent storage if you want historical snapshots to survive container replacement/redeploy. The included Render blueprint declares a disk; availability and cost depend on your hosting plan.
5. Deploy and open `/api/health` on the deployed URL.

Build and run locally with Docker:

```bash
docker build -t matchlab-analytics .
docker run --rm -p 4000:4000 \
  -e SERVE_CLIENT=true \
  -e FOOTBALL_DATA_API_KEY=your_token \
  -e BALLDONTLIE_API_KEY=your_key \
  -e DATA_STORE_PATH=/tmp/matchlab-store.json \
  matchlab-analytics
```

Open `http://localhost:4000`. The `/tmp` data store in the example is temporary; use a mounted volume for persistent records.

## Tests

```bash
npm test
```

The tests cover probability normalization, the Poisson baseline, historical date filtering, NBA estimate normalization, and evaluation metrics.

## Model and data limitations

- These are intentionally simple baselines, not production-grade forecasts. Football uses recent team scoring/conceding averages and a Poisson score distribution. NBA estimates use recent team points and points allowed with a simple margin-to-probability transform.
- Estimates use only data the provider makes available to the configured account. Provider quotas, coverage, and plan restrictions apply.
- The historical evaluation operates on locally stored records and should be treated as a diagnostic, not an unbiased scientific benchmark. A rigorous benchmark should use season-aware chronological train/test splits, prevent any data leakage, evaluate across multiple seasons, and compare against simple baselines.
- No injuries, player availability, lineups, rest, travel, tactical changes, opponent-strength adjustments, or other advanced covariates are modeled.
- Football-data.org may not provide shot or corner statistics for every competition. MatchLab does not invent missing statistics.
- Local JSON persistence is suitable for a single-instance starter deployment, not high-concurrency or multi-instance production. For larger deployments, migrate the store to PostgreSQL and add background ingestion, schema migrations, and monitoring.
- Provider keys are secret credentials. Keep them in your host's environment-variable manager and rotate them if accidentally exposed.
