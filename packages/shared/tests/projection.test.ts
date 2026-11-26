import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUnoGame } from '../src/games/uno/runtime.js';
import { DEFAULT_ROOM_SETTINGS, type Card, type GameEvent } from '../src/types.js';

const players = [0, 1, 2].map(seatIndex => ({
  seatIndex, key: String(seatIndex), name: String(seatIndex), isBot: false,
}));

// A deterministic shuffle and normal runtime actions produce a playable draw.
function playableDraw() {
  let state = 1;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  });
  const game = createUnoGame(players, DEFAULT_ROOM_SETTINGS);
  game.startRound();
  for (let i = 0; i < 108; i++) {
    const seat = game.gameView(0).current as number;
    if (game.phase === 'choose_color') game.apply(seat, { type: 'choose_color', color: 'red' });
    expect(game.apply(seat, { type: 'draw' }).ok).toBe(true);
    if (game.gameView(seat).drewThisTurn) return { game, seat };
  }
  throw new Error('Fixture did not produce a playable draw');
}

afterEach(() => vi.restoreAllMocks());

describe('UNO draw visibility', () => {
  it('keeps the playable drawn card in its owner’s hand and view', () => {
    const { game, seat } = playableDraw();
    const view = game.gameView(seat);
    const id = (view.drewThisTurn as Card).id;
    expect(view.meHand).toContainEqual(view.drewThisTurn);
    expect((view.lastEvent as GameEvent).cardIds).toEqual([id]);
  });

  for (const viewer of ['opponent', 'spectator'] as const) {
    it(`sends only public draw information to the ${viewer}`, () => {
      const { game, seat } = playableDraw();
      const view = game.gameView(viewer === 'spectator' ? -1 : (seat + 1) % players.length);
      expect(view.drewThisTurn == null && (view.lastEvent as GameEvent).cardIds === undefined).toBe(true);
      expect(view.lastEvent).toMatchObject({ type: 'draw', seat });
      expect((game.gameView(seat).lastEvent as GameEvent).cardIds).toHaveLength(1);
    });
  }
});
