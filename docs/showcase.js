// Three hand-worked teaching positions. Counts include the card being played.
const examples = {
  zero: {
    title: '乙打出 0', before: [0, 3, 5], after: [0, 5, 2],
    setup: '0 轮转已开启。乙出牌后还剩两张，观察谁接到这副手牌。',
    result: '甲保留第一名。乙把剩下的两张交给丙，接到丙的五张。轮到丙。'
  },
  seven: {
    title: '乙打出 7，选择丙', before: [0, 5, 2], after: [0, 2, 4],
    setup: '7 换手已开启。甲已经出完，乙可以选择仍在场的丙。',
    result: '丙接过乙余下的四张，乙接过两张。甲的手牌仍为空。轮到丙。'
  },
  reverse: {
    title: '乙打出反转', before: [0, 2, 3], after: [0, 1, 3], next: 1,
    setup: '只剩乙和丙还在争名次。乙出反转后还有一张牌。',
    result: '场上还剩两人，反转等同于跳过。乙继续出牌，甲保留第一名。'
  }
};
const names = ['甲', '乙', '丙'];
let selected = 'zero';
let played = false;
function renderPosition() {
  const example = examples[selected];
  const current = played ? example.next ?? 2 : 1;
  const counts = played ? example.after : example.before;
  document.querySelector('#seats').innerHTML = counts.map((count, i) =>
    `<div class="seat ${i === current ? 'active' : ''}"><b>${names[i]}</b><strong>${count}</strong><span> 张</span><p>${i === 0 ? '已出完 · 第一名' : i === current ? '当前回合' : '在场'}</p></div>`
  ).join('');
  document.querySelector('#move-title').textContent = example.title;
  document.querySelector('#move-desc').textContent = played ? example.result : example.setup;
  document.querySelector('#move').textContent = played ? '重放此局 ↺' : '打出这张牌 →';
  document.querySelector('#step-indicator').textContent = played ? '结算后' : '出牌前';
}
for (const button of document.querySelectorAll('[data-scenario]')) {
  button.addEventListener('click', () => {
    selected = button.dataset.scenario;
    played = false;
    document.querySelectorAll('[data-scenario]').forEach(other =>
      other.setAttribute('aria-pressed', String(other === button)));
    renderPosition();
  });
}
document.querySelector('#move').addEventListener('click', () => {
  played = !played;
  renderPosition();
});
document.querySelector('#copy').addEventListener('click', async event => {
  const button = event.currentTarget;
  const commands = document.querySelector('#commands');
  try {
    await navigator.clipboard.writeText(commands.textContent);
    button.textContent = '已复制';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(commands);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = '已选中，可复制';
  }
});
renderPosition();
