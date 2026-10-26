# 多人重置与单人原地重置分析

适配：Windows Steam 1.1.2.147157，Unity 2022.3.62f2。以下来自本机游戏脚本、IL2CPP 方法表和原生反汇编，以及模拟宿主验证；不表示已进行本版实机操作。提取文件仅保存在游戏目录的 `.single-space-local`，不放入源码仓库。

## 多人的实际入口

```text
PDAssistant.OnTeamBreedResetClick
  → BattleTeamBreedRun.SendResetFightBallte
  → BattleTeamBreedRunUtil.CanRestartFightRoom
  → BattleTeamBreedSyncSendRecv.SendStageReset(1)
  → 锁步指令 TsBreedStageReset
  → RecvResetFightBallte
  → BattleTeamBreedRunUtil.RestartFightRoom
```

原版模块中的定位：

| 模块 | 位置 | 行为 |
| --- | --- | --- |
| `Window/PDAssistant` | `OnTeamBreedResetClick`，370 行 | 确认对话框；成功发送指令后立即关闭暂停菜单 |
| `GamePlay/BattleTeamBreedRun/BattleTeamBreedRun` | 187–191 行 | 校验能否重置，发送/接收重置指令 |
| `GamePlay/Battle/BattleTeamBreedSyncSendRecv` | 15、62–67 行 | 序列化并分发 `TsBreedStageReset` |
| `GamePlay/BattleTeamBreedRun/BattleTeamBreedRunUtil` | 186–219 行 | 现有战斗内重建同一房间 |

`RestartFightRoom` 的顺序为：

1. 设置 `IsReseting`，关闭浮动窗口并锁定输入，调用联机 `ReviveAllPlayer`。
2. 播放遮罩，等待 400ms + 500ms。
3. 清理 Boss 来源增益、敌人、全屏效果、召唤物与部分效果，移动现有玩家到出生点。
4. `ClearSceneOnStagePreChange(false)`，清零战斗时间，设为 `NotStart`。
5. 克隆同一 `BattleContextBase`，调用当前 Battle 的 `EnterStage`。
6. `breedStagePreInit → commonStageInit → breedStageInit`，等待 1500ms 后揭开遮罩。
7. 释放输入锁并执行 `BattleProcess_TeamBreedEnterFight`，`BattleStart → NotifyBattleStart`。

这条流程保留 Battle、BattleJs、BattleUI、现有玩家和资源预加载器；没有 `ForceReloadGame`、登录或 Unity 场景切换。不能将 `BattleTeamBreedRun.ReStart`、断线 `FullSyncAndReset` 与这个菜单重置混为同一入口。

## 角色状态和写回边界

多人重置保留/复活当前角色，继续运行联机属性同步，并非从单人入场模型恢复角色。多人模块还包含 `SendSelfPlayerAttrSync`、角色/地下城 delta 同步、`GetUploadActiveAttr` 及携带 `activeAttrs` 的换房请求。重置函数本体未直接出现 REST 属性上传，这不能推断联机外围同步与原生复活流程没有状态更新。

单人补丁因此不调用任何多人重置、复活或同步入口，也不复用多人现有角色。只借鉴“同一 Battle 内 EnterStage”的房间重建方式：

- 唯一请求是 `ClientApiBreedDungeon.GetAsync()`，取得 `ModelBreedDungeon.Copy()` 返回的数据副本，并再做一次深复制。
- 只将副本装入当前 run 的 `enterData`，供原版 `SyncAttr` 和角色加载使用；不赋值服务端本地模型，不从当前角色生成任何属性数据。
- 不调用 `GetUploadActiveAttr`、`RequestEnterNextRoom`、FinishRoom、Quit、联机同步、ManualSave 或 `BreedDungeonLoad`。
- 不调用 `NotifyServerForRestore`。该入口会 POST `BreedDungeonLoad`；当前版本的 `BreedDungeonLoad` 会更新模型 `beginTimestamp`，本次无需这项模型变更。
- 不增加血量检查点，不读取实时数值血量/MP/药瓶/复活次数，不做 `SetHP` 校正；仅读取 `IsHPZero` 判断是否允许重置。

这是补丁本次重置的状态隔离边界。游戏其他正常流程与角色初始化本身的逻辑仍由原版管理，不能将该边界表述为禁止整个游戏的一切写盘。

## 单人的实施方式

1. 校验存档槽、地下城 ID/种子、角色 ID、阶段、房间索引、地图、未完成且存活；预加载结束后和遮罩覆盖后再次校验。
2. 立即关闭暂停菜单，保留原来的 BattleUI/InputGroup，锁定本次 `AsyncLoading` 输入位并冻结战斗。
3. 退出旧 BattleProcs 和延迟任务，清理敌人、旧玩家召唤物/子弹/掉落，原生 `RemovePlayerSelf` 移除角色。
4. 在同一 Battle 上执行 `EnterStage(context.Clone(), null, false)`。
5. 原版 `breedSelfPlayerLoad` 通过 `run.SyncAttr` 创建角色，初始化属性、盾/MP、技能、构筑增益和 Start 触发器，并调用 `ShowPlayerStatus` 重新绑定状态栏和角色输入。
6. 执行原版房间初始化和 `enterWithAutoCheckBattleState`；保留特殊 Boss 的原版入场分支。普通战斗入场由 `BattleProcess_EnterStage` 处理 AI、输入屏蔽解除和 BattleStart。
7. 检查同一 Battle/UI/预加载器，确认新玩家、Run、HUD、输入与加载状态就绪，记录耗时。

不再创建新 BattleJs，因此不会触发旧 BattleUI 的延迟 Uninit；不转移资源所有权，因此没有旧实验实现中的 `ExistingOldPreloader` 资源交接。原版 `breedSelfPlayerLoad` 会新建房间检查/屏外提示过程，所以先退出旧过程，避免连续重置累积计时器。

## 原生证据与验证范围

IL2CPP 方法表及反汇编定位：

| 方法 | RVA | 可确认的职责 |
| --- | --- | --- |
| `BattleBase.EnterStage` | `0x1BCB810` | 时间/统计重置、清理旧场景、初始化 BLL、场景破坏物及阶段通知 |
| `BattleBase.ClearSceneOnStagePreChange` | `0x1BCA6B0` | 关闭 BLL、清理出生过程、角色/子弹场景数据、环境触发器和手动时间任务 |
| `BattleBase.RemovePlayerSelf` | `0x1BD0C80` | 单人分支移除现有角色、清空 PlayerSelf 并 ValidatePlayers |
| `BattleBase.CreatePlayerSelf` | `0x1BCB110` | 由配置和属性集创建角色，初始化本地玩家、摄像机目标与生成通知 |

本机详细反汇编位于 `.single-space-local/inplace-native-evidence.txt`。

源码仓库的 11 项合成测试检查角色状态隔离、资源/UI 身份、清理、重复重置、多人与异常边界。本机 `.single-space-local/test_inplace_original.cjs` 另执行原版角色加载、普通入场过程和预加载器代码；Unity 原生对象、属性系统和实际场景仍使用模拟宿主。

仍需游戏内验证：实际性能；所有角色的召唤物/持续效果；攻击、跳跃、闪避和状态栏；特殊 Boss 开场；后续换房、死亡和正常保存/退出。现有模拟与静态证据不足以宣称这些已通过。
