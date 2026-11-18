import { test, expect, reserve, sessions } from '../support/fixtures.js';

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
