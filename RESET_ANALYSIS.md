# 多人重置与单人原地重置分析

适配：Windows Steam 1.1.2.147157 / 1.1.2.147368，Unity 2022.3.62f2。以下来自本机游戏脚本、IL2CPP 方法表和原生反汇编，以及模拟宿主验证；不表示已进行本版实机操作。提取文件仅保存在游戏目录的 `.single-space-local`，不放入源码仓库。

v0.2.1对 1.1.2.147368 的两处注入脚本及 19 个相关脚本做了内容比对，均与旧版一致；新增的是安装器的游戏更新迁移流程。下列原生 RVA 取自 1.1.2.147157，不能直接作为新版 GameAssembly 的地址。新版原生行为仍待游戏内验证。

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
- 将副本装入当前 run 的 `enterData`，供原版 `SyncAttr` 和角色加载使用；不从当前角色生成任何属性数据。v0.2.0 开启随机地图时仅更新本地模型当前房间的 `stageIdx`，不改角色数据。
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

## 可选的普通战斗房间重新抽图

v0.2.0（原 v0.1.7）在“设置 → 其他”增加“重置时随机普通房间”，默认关闭。设置通过独立 `PlayerPrefs` 键 `SingleSpaceReset.RerollNormalRoom` 保存，不使用角色存档。设置脚本独立注入 `Widget/MiscSettingsWidget`，因此主菜单也能修改；恢复默认设置关闭该选项。

原版 `Server/Model/BreedDungeon` 的 `currentRoomConf` 按当前房间类别、阶段主题和房间索引取得配置，并应用主题替换。`randomStageIdx`（339–410 行）对 Fight、Elite、SuperElite 从 `stageList` 筛选未出现的 `SceneTag`；无候选时回退到排除已用地图。Boss/FinalBoss 有独立分支，补丁不调用这些分支。

只在单人 BattleBreed 且开关启用时抽图。调用原版 `randomStageIdx` 时使用临时接收对象，复制阶段/历史数据并令临时 `baseInfo.seed=0`，让原版 PRNG 产生新抽取；存档种子不变。直接使用同一个存档种子会在同一房间重复确定性结果。无候选或仍选中原图时维持原地图。

新地图通过现有预加载器的 `StartPreloadStage → EndPreloadStage` 加载，遮罩覆盖并冻结战斗。预加载后再次检查战斗、存档槽、阶段和房间；成功后仅更新本地模型和运行副本当前房间的 `stageIdx`，再以新 `context.Stage` 进入原地重置。地图字段必须一致，否则后续 GET 与正常房间结算仍会使用旧地图。若原生场景尚未切换即失败，尝试还原地图字段；不进行角色属性上传或入场奖励重算。

房间奖励、Fight/Elite/SuperElite 类别、种子和角色数据保持原值。这里只重抽地图布局，不更换奖励房间类别。多人、Boss、虚拟空间、其他玩法以及强制调试地图不参与抽图。

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

源码仓库的 23 项合成脚本测试检查角色状态隔离、资源/UI 身份、重复重置、设置持久化、随机地图与异常边界，另有 8 项安装器测试。本机 `.single-space-local/test_inplace_original.cjs` 执行原版角色加载、普通入场过程和预加载器代码；`.single-space-local/test_reroll_original.cjs` 执行原版抽图和 PRNG、标签/已用地图筛选与连续八次随机重置。Unity 原生对象、属性系统和实际场景仍使用模拟宿主。

仍需游戏内验证：实际性能；所有角色的召唤物/持续效果；攻击、跳跃、闪避和状态栏；特殊 Boss 开场；后续换房、死亡和正常保存/退出。现有模拟与静态证据不足以宣称这些已通过。
