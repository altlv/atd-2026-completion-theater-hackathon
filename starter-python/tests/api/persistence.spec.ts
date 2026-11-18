import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, reserve, sessions } from '../support/fixtures.js';

test.describe('server log', () => {
  test('every write is logged as one JSON line with its outcome, without the alias or key', async ({ request, app }) => {
    const record = await (await reserve(request, 'secret-key-1', 'Zelda')).json();
    await reserve(request, 'secret-key-1', 'Zelda'); // replay
    await reserve(request, 'K2', 'Bob', 'NOPE'); // rejected
    await request.post(`/reservations/${record.id}/cancel`, { data: {} });
    await app.restart();

    const text = readFileSync(join(app.dataDir, 'server.log'), 'utf8');
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    const events = lines.filter((l) => l.event).map((l) => [l.event, l.status ?? null, l.reservationId ?? l.code ?? null]);
    expect(events).toEqual([
      ['server.start', null, null],
      ['reservation.created', 201, record.id],
      ['reservation.replayed', 200, record.id],
      ['rejected', 404, 'SESSION_NOT_FOUND'],
      ['reservation.cancelled', 200, record.id],
      ['server.start', null, null],
    ]);
    const lastStart = lines.filter((l) => l.event === 'server.start').at(-1);
    expect(lastStart.activeBySession, 'the restart logs what it found on disk').toEqual({ 'CT-101': 0, 'CT-102': 0 });
    expect(lines.every((l) => typeof l.ts === 'string')).toBe(true);
    expect(text, 'aliases must not be logged').not.toContain('Zelda');
    expect(text, 'request keys must not be logged').not.toContain('secret-key-1');
  });
});

test.describe('AC-07 durable state', () => {
  test('active and cancelled records survive a real process restart without reset', async ({ request, app }) => {
    const active = await (await reserve(request, 'K1')).json();
    const cancelled = await (await reserve(request, 'K2', 'Bob')).json();
    const cancelledRecord = await (await request.post(`/reservations/${cancelled.id}/cancel`, { data: {} })).json();
    const before = await sessions(request);
    expect(before['CT-101']).toEqual({ capacity: 2, activeCount: 1, remainingSeats: 1 });

    const pidBefore = app.pid;
    await app.restart();
    expect(app.pid, 'restart must start a new process').not.toBe(pidBefore);

    expect(await (await request.get(`/reservations/${active.id}`)).json()).toEqual(active);
    expect(await (await request.get(`/reservations/${cancelled.id}`)).json()).toEqual(cancelledRecord);
    expect(await sessions(request)).toEqual(before);
    expect(app.rows().map((r) => [r.id, r.status])).toEqual([[active.id, 'active'], [cancelled.id, 'cancelled']]);
  });

  test('a replay after restart still returns the original reservation', async ({ request, app }) => {
    const first = await (await reserve(request, 'K1')).json();
    await app.restart();
    const replay = await reserve(request, 'K1');
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(first);
    expect((await sessions(request))['CT-101'].activeCount).toBe(1);
  });
});
