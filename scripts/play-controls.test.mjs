import { strict as assert } from 'node:assert';
import test from 'node:test';
import { jumpInCards, numberBundle } from '../packages/client/src/uno-options.ts';

const red = { id: 1, kind: 'number', color: 'red', value: 5 };
const blue = { id: 2, kind: 'number', color: 'blue', value: 5 };
const blueCopy = { ...blue, id: 3 };
const skip = { id: 4, kind: 'skip', color: 'blue' };
const hand = [red, blue, skip];

test('抢出区分同数字与完全相同的牌，关闭时保留原先的等待流程', () => {
  assert.deepEqual(jumpInCards(hand, blueCopy, true), [blue]);
  assert.deepEqual(jumpInCards(hand, blueCopy, false), []);
});
test('连打保留选择的首牌与剩余顺序，单张及功能牌保留原入口', () => {
  assert.deepEqual(numberBundle(blue, hand, true), [blue, red]);
  assert.deepEqual(numberBundle(blue, hand, false), [blue]);
  assert.deepEqual(numberBundle(skip, hand, true), [skip]);
  assert.deepEqual(numberBundle(red, [red], true), [red]);
});

test('质疑窗口中的交互选项与引擎接牌接口一致', async () => {
  const { counterCards } = await import('../packages/client/src/uno-options.ts');
  const { UnoGame, DEFAULT_ROOM_SETTINGS, DEFAULT_HOUSE_RULES } = await import('../packages/shared/src/index.ts');
  const plusFour = { id: 10, kind: 'wild_draw_four', color: null };
  const replyFour = { ...plusFour, id: 11 };
  const replyTwo = { id: 12, kind: 'draw_two', color: 'green' };
  const hands = [replyFour, replyTwo, blue];
  for (const [stackDrawFour, crossStack] of [[false,false], [true,false], [false,true], [true,true]]) {
    const rules = { ...DEFAULT_HOUSE_RULES, stackDrawFour, crossStack };
    const choices = counterCards(hands, plusFour, rules);
    for (const card of hands) {
      const players = [0, 1, 2].map(seatIndex => ({ seatIndex, key: 'p' + seatIndex, name: '玩家', isBot: false }));
      const game = new UnoGame(players, { ...DEFAULT_ROOM_SETTINGS, houseRules: rules }, () => 0.42);
      game.startRound();
      Object.assign(game.state, { current: 0, direction: 1, discard: [red], activeColor: 'red', phase: 'play', pendingDraw: null });
      game.state.hands[0].cards = [plusFour, blueCopy];
      game.state.hands[1].cards = [...hands];
      assert.equal(game.play(0, [plusFour.id], 'green').ok, true);
      assert.equal(game.state.phase, 'challenge');
      assert.equal(game.play(1, [card.id], 'blue').ok, choices.includes(card));
    }
  }
});

test('点击候选转换成 game:play 的牌 ID 后，引擎实际执行抢出与同数字连打', async () => {
  const { UnoGame, DEFAULT_ROOM_SETTINGS, DEFAULT_HOUSE_RULES } = await import('../packages/shared/src/index.ts');
  const rules = { ...DEFAULT_HOUSE_RULES, jumpIn: true, multiplePlaySameNumber: true };
  const players = [0, 1, 2].map(seatIndex => ({ seatIndex, key: 'p' + seatIndex, name: '玩家', isBot: false }));
  const game = new UnoGame(players, { ...DEFAULT_ROOM_SETTINGS, houseRules: rules }, () => 0.42);
  game.startRound();
  Object.assign(game.state, { current: 0, direction: 1, discard: [blueCopy], activeColor: 'blue', phase: 'play', pendingDraw: null });
  game.state.hands[1].cards = [blue, skip];
  const jump = jumpInCards(game.state.hands[1].cards, blueCopy, true);
  assert.equal(game.play(1, jump.map(c => c.id)).ok, true);
  assert.equal(game.state.current, 2);
  assert.deepEqual(game.state.hands[1].cards, [skip]);
  const yellow = { ...red, id: 9, color: 'yellow' };
  game.state.hands[2].cards = [yellow, red, { ...skip, id: 7 }];
  const bundle = numberBundle(red, game.state.hands[2].cards, true);
  assert.equal(game.play(2, bundle.map(c => c.id)).ok, true);
  assert.equal(game.state.activeColor, 'yellow');
  assert.equal(game.state.hands[2].cards.length, 1);
});
