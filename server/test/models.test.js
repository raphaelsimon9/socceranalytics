import test from 'node:test';
import assert from 'node:assert/strict';
import { poisson, normalize, forecastFootball, forecastBasketball, evaluateForecasts, calibrationBins } from '../src/models.js';

test('Poisson probabilities are valid and decrease after the mode for a small rate', () => {
  assert.ok(poisson(1.5, 0) > 0);
  assert.ok(poisson(1.5, 1) > poisson(1.5, 5));
  assert.equal(poisson(-1, 2), 0);
});

test('normalization produces probabilities summing to one', () => {
  const values = normalize([2, 3, 5]);
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('football forecast returns normalized 1X2 probabilities and only uses earlier games', () => {
  const match = { id: 3, utcDate: '2024-03-10T12:00:00Z', status: 'SCHEDULED', homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' } };
  const history = [
    { id: 1, utcDate: '2024-02-01T12:00:00Z', status: 'FINISHED', homeTeam: { id: 1 }, awayTeam: { id: 2 }, homeScore: 2, awayScore: 0 },
    { id: 2, utcDate: '2024-02-02T12:00:00Z', status: 'FINISHED', homeTeam: { id: 2 }, awayTeam: { id: 1 }, homeScore: 1, awayScore: 1 },
    { id: 4, utcDate: '2024-03-11T12:00:00Z', status: 'FINISHED', homeTeam: { id: 1 }, awayTeam: { id: 2 }, homeScore: 0, awayScore: 5 }
  ];
  const result = forecastFootball(match, history);
  const p = result.probabilities;
  assert.ok(Math.abs(p.homeWin + p.draw + p.awayWin - 1) < 1e-10);
  assert.equal(result.sample.homeMatches, 2);
  assert.equal(result.sample.awayMatches, 2);
  assert.equal(result.expectedScore.home > 0, true);
});

test('basketball forecast returns two normalized outcome probabilities', () => {
  const game = { id: 2, date: '2024-02-01T00:00:00Z', season: 2023, home_team: { id: 1, full_name: 'A' }, visitor_team: { id: 2, full_name: 'B' } };
  const history = [{ id: 1, date: '2024-01-10T00:00:00Z', home_team: { id: 1 }, visitor_team: { id: 2 }, home_team_score: 112, visitor_team_score: 100 }];
  const result = forecastBasketball(game, history);
  assert.ok(Math.abs(result.probabilities.homeWin + result.probabilities.awayWin - 1) < 1e-12);
  assert.ok(result.expectedScore.total > 0);
});

test('evaluation metrics and calibration handle known results', () => {
  const rows = [
    { probabilities: [0.8, 0.2], actual: [true, false] },
    { probabilities: [0.3, 0.7], actual: [false, true] }
  ];
  const metrics = evaluateForecasts(rows);
  assert.equal(metrics.evaluated, 2);
  assert.equal(metrics.accuracy, 1);
  assert.ok(metrics.brierScore >= 0 && metrics.brierScore <= 1);
  assert.equal(calibrationBins(rows, 5).length, 5);
});

test('football forecast exposes goal-total distribution for 1.5 through 4.5', async () => {
  const { forecastFootball } = await import('../src/models.js');
  const fixture = { utcDate: '2025-06-01T12:00:00Z', homeTeam: { id: 1, name: 'Home' }, awayTeam: { id: 2, name: 'Away' } };
  const history = [];
  const result = forecastFootball(fixture, history);
  assert.deepEqual(result.goalTotals.map(x => x.line), [1.5, 2.5, 3.5, 4.5]);
  for (const row of result.goalTotals) {
    assert.ok(row.over >= 0 && row.over <= 1);
    assert.ok(row.under >= 0 && row.under <= 1);
    assert.ok(Math.abs(row.over + row.under - 1) < 1e-8);
  }
});

test('basketball forecast exposes total-points distribution', async () => {
  const { forecastBasketball } = await import('../src/models.js');
  const game = { date: '2025-06-01T12:00:00Z', home_team: { id: 1, full_name: 'Home' }, visitor_team: { id: 2, full_name: 'Away' } };
  const result = forecastBasketball(game, []);
  assert.ok(result.totalPointsDistribution.length > 0);
  assert.ok(result.totalPointsDistribution.every(x => x.over >= 0 && x.over <= 1 && x.under >= 0 && x.under <= 1));
});
