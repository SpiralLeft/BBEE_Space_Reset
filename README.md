# 苍翼：混沌效应 · 单人空间重置 Mod

在单人战斗的暂停菜单中增加“重置空间”按钮，参考多人模式的原地重置方式重新创建当前房间，从已有模型重新初始化角色。

当前版本：**v0.1.6（原地重置，待实机验证）**。适配 Windows Steam 版 **1.1.2.147157**，Unity **2022.3.62f2**。

## 功能

- 复用多人模式的“重置空间”按钮、图标和遮罩转场资源。
- 在现有战斗内执行 `EnterStage`，保留 Battle、BattleUI、输入组与预加载器。
- 通过原版 `breedSelfPlayerLoad` 从已有模型创建角色，初始化属性、技能、增益和触发器。
- 重置只读取本地模型，不上传实时血量、MP、药瓶和复活消耗，不主动保存存档。
- 不进入登录场景；遮罩覆盖等待为 400ms，之后仍需等待原版房间初始化及入场。
- 防止重复点击触发多个重置任务，多人模式继续使用原有重置逻辑。

**当前通过菜单按钮触发，尚未添加独立快捷键。** 尚未测得本版实机耗时；脚本和模拟验证不能替代游戏内回归。

## 安装

### 1. 准备环境

- Windows Steam 版《苍翼：混沌效应》**1.1.2.147157**。
- [Python 3.12（64 位）](https://www.python.org/downloads/)，安装时勾选 **Add python.exe to PATH**。
- [Node.js LTS](https://nodejs.org/)，使用默认安装选项即可。

正常关闭游戏。打开 PowerShell，确认以下命令均能输出版本号：

```powershell
python --version
node --version
```

### 2. 下载源码并放入游戏目录

在仓库页面选择 **Code → Download ZIP**，解压下载的文件。仓库仅需包含本项目的源码、兼容性哈希与文档；游戏资源由安装器从玩家已安装的游戏中读取。

在 Steam 库中右键游戏，选择 **管理 → 浏览本地文件**，打开包含 `BlazblueEntropyEffect.exe` 的游戏根目录。

将包含 `patch_single_space.py` 的源码文件夹命名为 `.interface-analysis`，复制到游戏根目录。若下载内容已经包含 `.interface-analysis` 文件夹，直接复制该文件夹即可。确保目录结构如下，安装所需的四个文件均已包含：

```text
游戏根目录/
├─ BlazblueEntropyEffect.exe
├─ BlazblueEntropyEffect_Data/
└─ .interface-analysis/
   ├─ patch_single_space.py
   ├─ single-space-reset.js
   ├─ supported-game.json
   └─ requirements.txt
```

不要把整个仓库文件夹再套一层放入游戏目录：安装器需要位于 `游戏根目录/.interface-analysis/patch_single_space.py`。

### 3. 安装依赖

在游戏根目录打开 PowerShell：在资源管理器地址栏输入 `powershell`，按回车。执行：

```powershell
python -m pip install --target .single-space-local\deps -r .interface-analysis\requirements.txt
```

此命令将 UnityPy 及其依赖安装到游戏根目录下的 `.single-space-local/deps` 文件夹，无需额外安装 Mod 加载器。依赖、资源备份、构建产物和日志均保存在 `.single-space-local`，源码目录保持独立。

### 4. 构建并安装补丁

继续在同一个 PowerShell 窗口执行：

```powershell
python .interface-analysis\patch_single_space.py build
python .interface-analysis\patch_single_space.py install
python .interface-analysis\patch_single_space.py status
```

依次确认每条命令成功结束，再执行下一条。`build` 构建补丁并校验资源；`install` 安装并核对哈希。最后，`status` 输出中的 `m_689.m` 和 `merge.json` 均显示 **`patched`**，即表示安装成功，可以启动游戏。

首次安装会备份原始资源。升级补丁时仍从原始备份构建，不会在旧补丁上反复叠加。游戏运行时安装器会拒绝写入。

### 更新 Mod

关闭游戏，用新版本的源码文件替换旧文件，保留 `.single-space-local` 中的备份和安装记录，然后重新执行上面的 `build`、`install`、`status` 三条命令。原版资源备份不需要随版本重新下载或替换。

从旧目录布局升级时，安装器会将 `.interface-analysis` 内旧位置的备份、安装记录、构建产物、日志和依赖迁至 `.single-space-local`；若新旧位置均已有同类数据，会拒绝自动合并，避免覆盖原始备份。

## 使用方法

1. 进入单人模式的战斗空间。
2. 打开游戏暂停菜单，选择“重置空间”。
3. 等待遮罩转场与原版入场完成，重新进入当前空间。

按钮仅在符合条件时显示：单人 `BattleBreed`、当前为未完成的战斗房间、角色存活，且没有其他加载或重置任务。虚拟空间、已完成房间及其他玩法不在当前支持范围内。

房间进度、角色构筑和活动属性来自当前存档的本地数据模型。重置只读取模型副本，移除当前战斗角色及其召唤物、子弹和未结算掉落，再交由原版角色创建流程恢复已有属性。

重置不调用实时角色属性上传、换房间、读档或手动保存接口，也不在创建后校正血量。已有模型中记录的血量比例、MP、药瓶和复活次数决定初始化结果；它不会将退出重置前的受伤或消耗状态提交回模型。游戏其他正常流程的自动保存保持原样。

## 卸载与还原

正常关闭游戏，在游戏根目录执行：

```powershell
python .interface-analysis\patch_single_space.py restore
python .interface-analysis\patch_single_space.py status
```

两项资源显示 `original` 即表示已恢复原版。还原只替换补丁修改的游戏资源，不还原存档，也不会撤销游戏中已经保存的进度。

原始资源备份位于 `.single-space-local/original/`。需要还原前请保留它；不要使用其他玩家或其他游戏版本的备份替换。卸载不需要 UnityPy，仅需 Python。

游戏更新或其他 Mod 修改同一资源后，安装器可能因哈希不匹配而拒绝操作。此时应先核对游戏版本和资源变化，不要绕过校验或直接覆盖新版本文件。当前未验证其他游戏版本及修改同一资源的 Mod 的兼容性。

## 工作原理

```text
暂停菜单：重置空间
  → GET 当前本地副本，校验存档/角色/阶段/房间
  → 等待正在执行的预加载完成
  → 关闭暂停菜单、遮罩覆盖、锁定重置期间输入
  → 退出旧战斗过程、清理旧角色/召唤物/子弹/掉落
  → EnterStage：在同一 Battle 内重建房间
  → breedSelfPlayerLoad：从模型初始化新角色
  → breedStagePreInit → commonStageInit → breedStageInit
  → 重新绑定角色输入与状态栏
  → 释放本次输入锁、执行原版入场
  → 检查战斗、输入与状态栏就绪
```

v0.1.6 移除 `QuitAsync → ManualSave → ResetDataBinding → ForceReloadGame` 路径。它也不使用旧实验版的 `ExistingOldPreloader → CreateBattleEx` 捷径，整个重置保持同一个 Battle、BattleUI 和预加载器，避免旧 UI 延迟回收注销输入组及资源管理器交接问题。

多人模式的核心链路、角色同步与单人模型隔离边界见 [重置功能分析](RESET_ANALYSIS.md)。

## 验证情况

- 11 项合成回归测试覆盖连续重置、血量/MP/药瓶/复活消耗隔离、同地图下一房间、切换存档、血量默认值、隐藏 HUD、多人成员入口、无效模型、预加载等待、防连点、准备阶段竞态、转场中断、原生失败和入场超时。
- 本机原版脚本交叉检查执行 `breedSelfPlayerLoad`、`enterWithAutoCheckBattleState` 和 `BattleProcess_EnterStage`，连续重置三次；原版 `BattlePreloader` 的阶段预加载/收尾与后续房间预加载验证通过。其 Unity 原生对象由模拟宿主提供，未随仓库分发提取脚本。
- 安装器的 5 项测试、JavaScript 语法检查、TextAsset 二进制往返、原始资源前缀一致性、单条 manifest 偏移变更和安装哈希检查均已通过。
- **v0.1.6 尚未完成实机回归。** 特殊 Boss 入场、所有角色的召唤物/持续效果、攻击/跳跃/闪避、后续关卡资源和长时间游玩仍需实机检查。没有实机性能数字。

日志中的 `complete` 表示程序就绪检查通过，不代表所有按键和资源均经过人工验证。旧版 v0.1.3/v0.1.5 的实机日志对应完整重载，不能作为本版原地重置的运行证据。

## 日志与问题定位

日志位于 `.single-space-local/runtime.log`。当前诊断标记为 `"version":"0.1.6"`；旧版日志中的 `"version":3` 对应 v0.1.3。

正常阶段依次为 `begin`、`room-rebuilt`、`complete`。`complete.elapsedMs` 记录本次总耗时；若 30 秒内未满足入场就绪条件，会记录 `entry-timeout` 和错误信息。

当前版本不记录角色血量。旧日志中的 `health-checkpoint`、`health-restored`、`health-error` 属于 v0.1.4，升级后不再生成。

遇到问题时，请在仓库 Issues 中提供 Mod 版本、游戏版本、所在空间、触发步骤、具体失效的按键或界面，以及对应的日志。若重置失败且战斗无法继续，请返回主菜单后使用原版“继续游戏”入口。

常见安装问题：

| 提示或现象 | 处理方法 |
| --- | --- |
| 找不到 `python` 或 `node` 命令 | 确认安装时已加入 PATH，重新打开 PowerShell；若仍无效，修复相应软件的安装。 |
| `No module named UnityPy` | 在游戏根目录重新执行“安装依赖”中的命令。 |
| 找不到脚本或 `supported-game.json` | 核对第二步的目录结构，确认文件已解压且没有多套一层目录。 |
| 提示先关闭游戏 | 正常退出游戏后重新执行安装命令。 |
| 哈希不匹配或提示原始脚本版本不符 | 核对游戏版本及其他 Mod 的资源修改，保留原备份，不要强制覆盖。 |
| 安装成功但没有按钮 | 确认已重启游戏，且处于角色存活、尚未完成的单人战斗房间。 |

## 文件索引

| 路径（相对于游戏根目录） | 用途 |
| --- | --- |
| `.interface-analysis/RESET_ANALYSIS.md` | 多人重置调用链、单人状态隔离与原生证据 |
| `.interface-analysis/single-space-reset.js` | Mod 注入源码 |
| `.interface-analysis/patch_single_space.py` | 构建、安装、状态查询和还原工具 |
| `.interface-analysis/requirements.txt` | 构建所需的 Python 依赖 |
| `.interface-analysis/supported-game.json` | 兼容的游戏版本、目标资源路径与校验哈希，不包含游戏脚本 |
| `.interface-analysis/tests/test_installer.py` | 使用合成数据的安装、升级、回滚、还原与迁移测试 |
| `.interface-analysis/tests/test_inplace_reset.cjs` | 使用合成宿主对象的原地重置、状态隔离与异常清理测试 |
| `.single-space-local/build/` | 自动生成的构建产物与校验记录 |
| `.single-space-local/installed.json` | 已安装版本与资源哈希 |
| `.single-space-local/original/` | 首次安装时保留的原版资源 |
| `.single-space-local/runtime.log` | 运行诊断日志 |

## 仓库内容与开发测试

`.interface-analysis` 是可独立作为仓库根目录的 Mod 源码目录，包含 README、安装器、注入脚本、依赖声明、兼容性哈希、测试与 Git 忽略规则。它不包含提取或反编译的游戏脚本、游戏二进制资源、存档、依赖包或构建产物。

`.single-space-local` 是玩家机器上的安装状态目录，其中的原版备份与构建产物包含游戏资源，不能随仓库发布。上传时使用 `.interface-analysis` 内的文件；两个目录的用途不同。

在游戏根目录运行安装器测试，无需游戏资源或 UnityPy：

```powershell
python -B -m unittest discover -s .interface-analysis\tests -v
node --test .interface-analysis\tests\test_inplace_reset.cjs
```

在独立仓库根目录运行时，使用 `python -B -m unittest discover -s tests -v` 和 `node --test tests/test_inplace_reset.cjs`。这些测试使用合成数据，不分发或读取游戏源文件。

## 版本记录

**v0.1.6**：参考多人模式改为同一 Battle 内 `EnterStage` 原地重置，保留 UI/输入组和预加载器；只读已有模型并通过原版流程创建角色，移除完整重载及保存步骤。待实机验证。

**v0.1.5**：移除额外血量检查点与校正，角色状态完全交给原版存档恢复；重置不上传实时角色状态。

**v0.1.4**：增加房间入场血量检查点，自动读档初始化完成后恢复血量；连续重置保留同一检查点，增加存档与房间隔离及血量恢复诊断。

**v0.1.3**：改用完整“退出 → 保存 → 自动重读存档”流程，保留场景与资源初始化；增加输入、状态栏和加载状态检查。

**v0.1.2**：调整旧战斗界面回收、输入解锁顺序和转场，但仍存在输入、状态栏及后续资源加载问题。

**v0.1.1**：首次加入单人“重置空间”菜单按钮，采用直接重建战斗的实验实现。
