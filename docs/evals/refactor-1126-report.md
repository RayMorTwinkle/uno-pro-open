# 已经出完牌的人，怎么又拿到了两张牌？

2026-11-26 · UNO-PRO 规则引擎对照评测

四人逐名次赛，开启「0 轮转、7 换手」。种子 1 的第 64 步，2 号席用换手动作点了已经取得第一名的 4 号席。引擎接受选择，4 号席重新持有两张牌，2 号席变成空手。此时名次仍只有 4 号席。相同种子在重构后于第 99 步正常结算。完整记录包含每个失败种子的第一处异常、动作及席位牌数。[基线逐局记录](artifacts/baseline-replay.json) · [重构后逐局记录](artifacts/refactor-replay.json)

## 结果

| 评价项 | 备份 | 重构 | 判定单位 |
| --- | ---: | ---: | --- |
| 首人出完即结束 | 64/64 | 64/64 | 合规结算的牌局 |
| 默认逐名次赛 | 59/64 | 64/64 | 合规结算的牌局 |
| 逐名次赛 + 0 轮转 + 7 换手 | 6/64 | 64/64 | 合规结算的牌局 |
| 定向规则回归 | 2/16 | 16/16 | 通过的固定牌例 |
| 摸牌可见性 | 1/3 | 3/3 | 通过的身份视角 |

系统从加入名次表时起检查该席是否保持空手、是否重新取得普通操作权、名次是否重复。在「末张万能」的分步选色期间仍允许原出牌者确定颜色。逐名次赛须在结束时排出前三名，并在 2,000 次动作内完成。基线的 0/7 组合组中，50 局首先违反空手约束，8 局首先违反操作权约束；另有 6 局通过所有断言。默认组的 5 次失败均为已排名席位重新获得操作权。[判定脚本](artifacts/replay-ranked.mts) · [原始基线](artifacts/baseline-replay.json)

备份自带套件 65 项全部通过。当前共享规则套件 84 项全部通过，含原有五个游戏的测试、上述定向规则及视角用例。最终私仓入口另运行 4 项客户端规则交互测试，验证抢出、同数字连打和质疑窗口反制的候选动作。定向用例和视角的两列使用相同测试代码，完整套件的规模因新增回归而不同。[备份全套](artifacts/baseline-suite.txt) · [当前全套](artifacts/refactor-suite.txt) · [定向基线](artifacts/baseline-ranked.txt) · [定向复测](artifacts/refactor-ranked.txt) · [视角基线](artifacts/projection-before.log) · [视角复测](artifacts/projection-after.log)

## 这次改了什么

- **轮到谁。** 引擎在原座位顺序中循方向寻找仍在场的人。三人桌有人用末张反转出完时，方向翻转，下一位有效座位接手。还留有手牌的玩家在两人残局打出反转，保留再行动一次的规则。新一轮清空本轮名次，同时保留跨轮淘汰，首位从仍在场的人中产生。[规则引擎](../../packages/shared/src/engine.ts)
- **牌给谁。** 0 只在仍在场的玩家之间轮转。7 要求双方都有交换资格，已出完的玩家用末张 7 定名次后直接交棒。玩家点选、机器人换手和调度采用相同席位条件。收到不可用目标时，引擎保留选择窗口，下一次可以选合法目标。[定向牌例](../../packages/shared/tests/ranked-seats.test.ts) · [AI 策略](../../packages/shared/src/bot.ts)
- **上一张究竟是什么颜色。** 红牌之后有人出万能改绿，再有人出 +4 并分两步选蓝。质疑看的是出 +4 前生效的绿色。引擎在覆盖前保存它，停止从弃牌堆倒找最近的有色牌。已有质疑数据缺少旧色时仍兼容旧回退逻辑。[规则引擎](../../packages/shared/src/engine.ts)
- **谁看见摸到的牌。** 摸到可打牌的座位可以看到牌面。对手和观战者仍收到摸牌事件，其视图隐藏刚摸到的牌和摸牌事件中的具体牌号。这次覆盖单局运行时的这三个视角。[运行时视图](../../packages/shared/src/games/uno/runtime.ts) · [视角回归](../../packages/shared/tests/projection.test.ts)

## 面试讨论

**产品经理 · 两人残局和三人桌末张反转为何不同？** 把验收条件写成玩家能观察的结果。前一种局面，出反转的人仍有牌；后一种局面，他刚锁定名次，屏幕应指向另一个玩家。逐名次、换手、淘汰分别写需求时容易各自正确，联用时必须回答名次能否撤销、谁能交换、谁有权完成当前动作。末张万能仍可选色，就是「取得名次」与「完成已打出的牌」可以并存的例子。[定向牌例](../../packages/shared/tests/ranked-seats.test.ts)

**AI Agent 开发 · 为什么四档策略都选错过换牌目标？** 旧代码允许选已经出完的席位。按牌数最少选对手的策略，恰好最喜欢那个空手的席位；随机策略也有机会选中它。修复让所有难度先从引擎取有效候选，进攻性与随机性继续由策略决定。评测走真实的调度、决策、执行和视图入口，首人即赢组充当控制组。这里的 AI 是规则策略，没有模型推理或训练环节。[AI 策略](../../packages/shared/src/bot.ts) · [回放入口](artifacts/replay-ranked.mts)

**后训练与评测 · 怎样避免把测试写成答案？** 固定牌例回答具体边界是否按约定处理，逐局回放则只断言席位、手牌、名次及终局约束。三组重复同一批起始种子，四档策略轮换座位，保留所有失败和首个异常动作。两版决策路径会因修复分叉，步数不宜拿来比较速度。可用这些状态和动作记录设计后续策略评测，但这批数据没有做人类偏好标注，也没有测各难度胜率。[回放脚本](artifacts/replay-ranked.mts) · [逐局原始结果](artifacts/refactor-replay.json)

## 如何复跑

环境为 Darwin arm64，Node 24.15.0、npm 11.12.1、Vitest 2.1.9。评测对象为只读归档的备份提交 `aed7a753d8bb7c70e1ccf65824211b408476e581` 和重构工作树。两侧共享同一份锁文件安装的工具链。实际引擎、运行时、脚本和测试的 SHA-256 可用于辨认版本。[环境与文件指纹](artifacts/environment.json)

从项目根目录执行；输出写往临时目录。重构版本两项命令应成功。

```bash
npm ci
result_dir=$(mktemp -d)
sh docs/evals/artifacts/run-ranked.sh . "$result_dir"
sh docs/evals/artifacts/run-projection.sh .
npm test
```

持有原仓备份分支时可以独立重建基线。开源仓使用新历史，附带原始基线工件；有原仓访问权限者可执行以下命令。备份对新增断言会以非零状态结束，重放 JSON 仍写入临时目录。

```bash
baseline_dir=$(mktemp -d)
baseline_out=$(mktemp -d)
git archive backup1126 packages/shared | tar -x -C "$baseline_dir"
ln -s "$PWD/node_modules" "$baseline_dir/node_modules"
sh docs/evals/artifacts/run-ranked.sh "$baseline_dir" "$baseline_out"
sh docs/evals/artifacts/run-projection.sh "$baseline_dir"
```

**适用范围。** 每组为四人、稀疏席位 0/2/4/6、种子 1–64。模拟时钟每步推进 100 毫秒，随机数使用固定的 32 位线性同余生成器。每步由调度返回的首个责任席决策，覆盖当前回合的同步交互。网络并发、非当前席的异步抢出、重连、浏览器渲染延迟及真人对局需要另外测量。这些计数只描述本批样本。

## 独立开源包验收

本机回环和经本机实际局域网网卡地址的两次 Socket.IO 验收均通过。覆盖建房、加四档 AI、切换十二项设置、另一玩家入座、观战和断线返回；另四款游戏各自验证开局。局域网验收的连接均在同一台主机，未使用第二台实体手机。[回环记录](artifacts/open-room-local.txt) · [网卡记录](artifacts/open-room-lan.txt) · [烟测脚本](../../scripts/room-smoke.test.mjs)

新目录与空 npm 缓存下运行 README 的两条命令，验收进程实际请求了健康接口、首页与首页引用的客户端脚本。结果对应这台机器与当次网络环境，可从干净检出的开源仓根目录运行 `python3 docs/evals/artifacts/verify-open-startup.py .` 复核。[启动验收](artifacts/open-startup.json) · [验收脚本](artifacts/verify-open-startup.py)
