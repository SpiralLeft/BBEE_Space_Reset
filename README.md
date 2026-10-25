# 苍翼：混沌效应 · 单人空间重置 Mod

在单人战斗的暂停菜单中增加“重置空间”按钮，一键自动执行原版“返回主菜单 → 继续当前存档”的流程，重新进入当前战斗空间。

当前版本：**v0.1.5**。适配 Windows Steam 版 **1.1.2.147157**，Unity **2022.3.62f2**。

## 功能

- 复用多人模式的“重置空间”按钮、图标和遮罩转场资源。
- 自动退出当前战斗、保存并重新读取当前存档，无需手动操作主菜单和存档选择。
- 保留原版场景退出、登录初始化、战斗恢复和资源预加载流程。
- 血量、MP、药瓶等角色状态由原版存档恢复，重置时不上传实时角色状态。
- 跳过本次加载提示的最低展示等待，防止重复点击触发多个重置任务。
- 多人模式继续使用游戏原有的重置逻辑。

**当前通过菜单按钮触发，尚未添加独立快捷键。** 本版仍会加载必要的场景和资源，不能实现零加载；主要减少中间操作和提示等待。

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
3. 等待转场与自动读档完成，重新进入当前空间。

按钮仅在符合条件时显示：单人 `BattleBreed`、当前为未完成的战斗房间、角色存活，且没有其他加载或重置任务。虚拟空间、已完成房间及其他玩法不在当前支持范围内。

房间进度、角色构筑、血量、MP、药瓶及复活次数均由原版存档与角色初始化流程恢复。重置时，Mod 按原版返回主菜单的顺序保存已有数据模型，不上传当前战斗中的角色状态；随后通过原版读档入口恢复游戏记录的房间入场状态。

Mod 不单独保存角色状态，不增加内存或文件中的血量检查点，也不在读档后修改血量。恢复结果以原版存档和入场规则为准，与手动返回主菜单后继续同一存档使用相同的角色恢复路径。

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
  → 校验当前存档房间
  → 关闭暂停菜单
  → QuitAsync → ManualSave → ResetDataBinding
  → ForceReloadGame
  → SceneLogin → 自动 Login.StartGame
  → LoadData → OnLoginSuccess
  → RestoreBreedAndExplore → BattleBreedRun.Restore
  → 正常预加载、SceneFight 和战斗初始化
  → 原版存档与角色初始化恢复角色状态
  → 检查输入与状态栏就绪
```

v0.1.3 完整复用原版的退出和读档生命周期，由游戏恢复输入、状态栏和资源管理器。它不再使用旧版直接重建战斗、保留旧预加载器的捷径。

原版的 `RequestEnterNextRoom` 在切换房间前上传血量比例等活动属性，`BreedDungeonEnterRoom` 更新模型并处理入场回血；正常换房间接着刷新现有角色的属性并执行入场触发器。返回主菜单的 `QuitAsync → ManualSave` 只保存已有模型，不会上传退出时的实时战斗血量。重新读档则从模型重新创建角色并初始化属性、增益和触发器。当前适配版本的单人 `BreedDungeonLoad` 未发现读档扣血逻辑。

v0.1.5 完全交由上述原版路径恢复血量，移除了 v0.1.4 的额外血量检查点、房间开始钩子及读档后 `Attr.SetHP` 校正。

补丁只修改 `data/js/window/pdassistant.ab` 对应的脚本资源：将重建的 Unity bundle 追加至 `BlazblueEntropyEffect_Data/StreamingAssets/ab/m_689.m`，并调整 `merge.json` 中该资源的偏移。原合并文件的内容保留为前缀，不修改 `GameAssembly.dll`，不依赖 BepInEx。

## 验证情况

- 已通过 JavaScript 语法检查、TextAsset 二进制往返、原始资源前缀一致性、单条 manifest 偏移变更及安装后哈希检查。
- 脚本回归测试执行游戏原版的重载、登录、恢复入口和正常预加载分支，覆盖同一存档保存/重读、资源交接、后续房间预加载、重复重置、防连点、多人分支及失败清理。
- v0.1.3 的运行诊断已在两个不同战斗空间记录完成重置：输入锁为零，攻击/跳跃/闪避未被阻止，状态栏处于显示状态，预加载回调队列为空。
- v0.1.5 的 8 项合成存档恢复测试通过，覆盖受伤后的状态恢复、重复重置、同地图下一房间、切换存档、原版血量比例与默认值、无效房间及多人分支；同时检查 Mod 不读取实时角色属性、不挂接房间开始通知、不调用血量校正接口。安装器的 5 项测试通过。
- v0.1.5 已通过原版重载、登录和正常预加载入口的本地模拟回归，游戏内效果待实机验证。

日志中的 `complete` 是程序状态检查结果。全部按键的实际响应、完整关卡资源以及长时间游玩的稳定性，仍需实机回归，不能仅凭日志判定全部通过。

脚本测试会模拟 Unity、本地 API 及部分运行对象，不等同于实机测试。

## 日志与问题定位

日志位于 `.single-space-local/runtime.log`。当前诊断标记为 `"version":"0.1.5"`；旧版日志中的 `"version":3` 对应 v0.1.3。

正常阶段依次为 `begin`、`quit-saved`、`auto-login-started`、`complete`。若 90 秒内未满足就绪条件，会记录 `restore-timeout` 和错误信息。

当前版本不记录角色血量。旧日志中的 `health-checkpoint`、`health-restored`、`health-error` 属于 v0.1.4，升级后不再生成。

遇到问题时，请在仓库 Issues 中提供 Mod 版本、游戏版本、所在空间、触发步骤、具体失效的按键或界面，以及对应的日志。若自动读档失败并停在主菜单，可使用原版“继续游戏”入口。

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
| `.interface-analysis/single-space-reset.js` | Mod 注入源码 |
| `.interface-analysis/patch_single_space.py` | 构建、安装、状态查询和还原工具 |
| `.interface-analysis/requirements.txt` | 构建所需的 Python 依赖 |
| `.interface-analysis/supported-game.json` | 兼容的游戏版本、目标资源路径与校验哈希，不包含游戏脚本 |
| `.interface-analysis/tests/test_installer.py` | 使用合成数据的安装、升级、回滚、还原与迁移测试 |
| `.interface-analysis/tests/test_save_reload.cjs` | 使用合成宿主对象的原版存档恢复与状态隔离测试 |
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
node --test .interface-analysis\tests\test_save_reload.cjs
```

在独立仓库根目录运行时，使用 `python -B -m unittest discover -s tests -v` 和 `node --test tests/test_save_reload.cjs`。这些测试使用合成数据，不分发或读取游戏源文件。

## 版本记录

**v0.1.5**：移除额外血量检查点与校正，角色状态完全交给原版存档恢复；重置不上传实时角色状态。

**v0.1.4**：增加房间入场血量检查点，自动读档初始化完成后恢复血量；连续重置保留同一检查点，增加存档与房间隔离及血量恢复诊断。

**v0.1.3**：改用完整“退出 → 保存 → 自动重读存档”流程，保留场景与资源初始化；增加输入、状态栏和加载状态检查。

**v0.1.2**：调整旧战斗界面回收、输入解锁顺序和转场，但仍存在输入、状态栏及后续资源加载问题。

**v0.1.1**：首次加入单人“重置空间”菜单按钮，采用直接重建战斗的实验实现。
