# 苍翼：混沌效应 · 单人空间重置 Mod

在单人战斗的暂停菜单中增加“重置空间”按钮，一键自动执行原版“返回主菜单 → 继续当前存档”的流程，重新进入当前战斗空间。

当前版本：**v0.1.3**。适配 Windows Steam 版 **1.1.2.147157**，Unity **2022.3.62f2**。

## 功能

- 复用多人模式的“重置空间”按钮、图标和遮罩转场资源。
- 自动退出当前战斗、保存并重新读取当前存档，无需手动操作主菜单和存档选择。
- 保留原版场景退出、登录初始化、战斗恢复和资源预加载流程。
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

重置以游戏存档为准，不是任意时刻的战斗快照。角色、房间进度及可能产生的读档扣血等行为，沿用原版“返回主菜单后继续游戏”的规则。

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
  → 检查输入与状态栏就绪
```

v0.1.3 完整复用原版的退出和读档生命周期，由游戏恢复输入、状态栏和资源管理器。它不再使用旧版直接重建战斗、保留旧预加载器的捷径。

补丁只修改 `data/js/window/pdassistant.ab` 对应的脚本资源：将重建的 Unity bundle 追加至 `BlazblueEntropyEffect_Data/StreamingAssets/ab/m_689.m`，并调整 `merge.json` 中该资源的偏移。原合并文件的内容保留为前缀，不修改 `GameAssembly.dll`，不依赖 BepInEx。

## 验证情况

- 已通过 JavaScript 语法检查、TextAsset 二进制往返、原始资源前缀一致性、单条 manifest 偏移变更及安装后哈希检查。
- 脚本回归测试执行游戏原版的重载、登录、恢复入口和正常预加载分支，覆盖同一存档保存/重读、资源交接、后续房间预加载、重复重置、防连点、多人分支及失败清理。
- v0.1.3 的运行诊断已在两个不同战斗空间记录完成重置：输入锁为零，攻击/跳跃/闪避未被阻止，状态栏处于显示状态，预加载回调队列为空。

日志中的 `complete` 是程序状态检查结果。全部按键的实际响应、完整关卡资源以及长时间游玩的稳定性，仍需实机回归，不能仅凭日志判定全部通过。

脚本测试会模拟 Unity、本地 API 及部分运行对象，不等同于实机测试。

## 日志与问题定位

日志位于 `.single-space-local/runtime.log`。v0.1.3 使用的内部诊断标记为 `"version":3`；该数字是诊断代号，不是 Mod 的发行版本号。

正常阶段依次为 `begin`、`quit-saved`、`auto-login-started`、`complete`。若 90 秒内未满足就绪条件，会记录 `restore-timeout` 和错误信息。

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
```

在独立仓库根目录运行时，使用 `python -B -m unittest discover -s tests -v`。这些测试使用合成字节，不分发或读取游戏源文件。

## 版本记录

**v0.1.3**：改用完整“退出 → 保存 → 自动重读存档”流程，保留场景与资源初始化；增加输入、状态栏和加载状态检查。

**v0.1.2**：调整旧战斗界面回收、输入解锁顺序和转场，但仍存在输入、状态栏及后续资源加载问题。

**v0.1.1**：首次加入单人“重置空间”菜单按钮，采用直接重建战斗的实验实现。
