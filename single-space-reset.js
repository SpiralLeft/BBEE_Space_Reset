// Appended to Window/PDAssistant. Keep the game's quit/login/restore lifecycle.
;(() => {
    "use strict";
    const Run = require("GamePlay/BattleBreedRun/BattleBreedRun").default;
    const RunBase = require("GamePlay/Battle/BattleRunBase").BattleRunBase;
    const Battle = require("GamePlay/Battle/BattleJs").default;
    const Preloader = require("GamePlay/Battle/BattlePreloader").default;
    const Define = require("GamePlay/BattleBreedRun/BattleBreedRunDefine").BattleBreedRunDefine;
    const Api = require("Server/Struct/ClientRequestStruct");
    const Global = require("Manager/TsGameGlobal").default;
    const Save = require("Manager/TsDataSaveManager").default;
    const Archive = require("Archive/ArchiveEnv").default;
    const Data = require("DataBinding");
    const UI = require("Core/UIUtil").default;
    const Windows = require("Core/WindowUtil").default;
    const Loading = require("Window/Loading").default;
    const U = require("Core/Util").U;
    const Cs = require("csharp");
    const Menu = exports.default;
    if (Menu.prototype.__singleSpaceResetV5) return;
    Menu.prototype.__singleSpaceResetV5 = true;
    let busy = false;

    function trace(event, detail = {}) {
        const line = JSON.stringify({ time: new Date().toISOString(), version: "0.1.5", event, ...detail });
        console.info("SingleSpaceReset", line);
        try {
            const directory = Cs.UnityEngine.Application.dataPath + "/../.single-space-local";
            Cs.System.IO.Directory.CreateDirectory(directory);
            Cs.System.IO.File.AppendAllText(directory + "/runtime.log", line + "\n");
        } catch (_) { /* Diagnostics must not affect gameplay. */ }
    }

    function playTransition(name) {
        const param = new Cs.NOAH.VFX.EffectPlayParam();
        param.name = "UI/Common/RoomSelect_Mask_" + name;
        param.target = UI.UIManagerInstance.WindowOverlay;
        param.dontStop = true;
        param.bind = true;
        return U.GetSingleton(Cs.NOAH.VFX.VFXManager).PlayEffect(param);
    }

    function stopTransition(effect) {
        try { effect?.Stop(true, true); } catch (_) { /* Scene exit can dispose it. */ }
    }

    function canReset() {
        const js = Battle.Instance;
        const run = Run.SilentInstance;
        return !busy && js?.BattleClassName === "BattleBreed" && !!run &&
            RunBase.Instance === run && !Cs.PvpDefine.IsOnlineMode() && !run.isVirtualStage &&
            !run.curPhaseInfo?.finished && !run.dungeon?.baseInfo?.dead &&
            !!run.currentRoom && !run.currentRoom.finished &&
            Define.IsFightRoomType(run.currentRoom.roomType) &&
            js.Battle?.BattleState === Cs.GamePlay.BattleState.Run &&
            !!js.Battle.PlayerSelf && !js.Battle.PlayerSelf.Attr.IsHPZero &&
            !js.BossDieShowing && js.PauseCount <= 1 && !!js.Preloader &&
            !Preloader.loadBattleExLock && !Preloader.ExistingOldPreloader &&
            !Global.Instance.loadingPromise &&
            Cs.UnityEngine.SceneManagement.SceneManager.GetActiveScene().name === "SceneFight";
    }

    function validateSnapshot(dungeon, run, stage) {
        const phases = dungeon?.baseInfo?.phases;
        const phase = phases?.[phases.length - 1];
        const room = phase?.rooms?.[phase.currentStageIndex - 1];
        if (!dungeon?.actorInfo?.fesActor || dungeon.baseInfo.dead ||
            dungeon.baseInfo.id !== run.dungeonId ||
            dungeon.baseInfo.currentPhase !== run.currentPhase ||
            phase?.phaseIndex !== run.curPhaseInfo.phaseIndex || phase.finished ||
            phase.currentStageIndex !== run.currentStageIndex || !room ||
            room.finished || room.stageIdx !== stage || !Define.IsFightRoomType(room.roomType)) {
            throw new Error("The saved combat room does not match the active room");
        }
    }

    function state() {
        const js = Battle.Instance;
        const manager = U.GetSingleton(Cs.GamePlay.GameInputManager);
        const input = js?.Battle?.PlayerSelf?.Input;
        const refs = js?.UIMain?.R;
        return {
            scene: Cs.UnityEngine.SceneManagement.SceneManager.GetActiveScene().name,
            stage: js?.Battle?.BattleContextBase.Stage,
            battleState: js?.Battle?.BattleState,
            inBattle: manager.IsInBattle,
            actorFlags: manager.ActorActionFlag, uiFlags: manager.UIActionFlag,
            attackBlocked: input?.IsInputCmdBlock(Cs.GamePlay.InputCmd.Attack),
            jumpBlocked: input?.IsInputCmdBlock(Cs.GamePlay.InputCmd.Jump),
            dashBlocked: input?.IsInputCmdBlock(Cs.GamePlay.InputCmd.Dash),
            hudActive: js?.UIMain?.CsObj.gameObject.activeInHierarchy,
            statusActive: refs?.SelfStatus?.gameObject.activeInHierarchy,
            hudAlpha: refs?.HiddenConent?.alpha,
            hudSetting: Data.DB.Battle.BattleUIOpen.Value,
            loading: !!UI.FindWindow(Loading),
            preloadCallbacks: Preloader.AdditinalLoadFuncs.length
        };
    }

    async function waitForRestore(oldJs, oldRun, stage, slot) {
        const start = Cs.UnityEngine.Time.realtimeSinceStartup;
        let stable = 0;
        for (;;) {
            if (Archive.ActiveSlot !== slot) throw new Error("The active save slot changed during reset");
            const s = state();
            const setting = U.GetSingleton(Cs.SettingsManager).MiscSettings.BattleUIOpen;
            const ready = Battle.Instance && Battle.Instance !== oldJs &&
                Run.SilentInstance && Run.SilentInstance !== oldRun &&
                s.scene === "SceneFight" && s.stage === stage &&
                s.battleState === Cs.GamePlay.BattleState.Run && s.inBattle &&
                s.actorFlags === 0 && s.uiFlags === 0 &&
                s.attackBlocked === false && s.jumpBlocked === false && s.dashBlocked === false &&
                s.hudActive && s.hudSetting === setting &&
                (!setting || (s.statusActive && s.hudAlpha > 0)) &&
                !s.loading && !Global.Instance.loadingPromise &&
                !Preloader.loadBattleExLock && s.preloadCallbacks === 0;
            if (ready && ++stable >= 3) return s;
            if (!ready) stable = 0;
            if (Cs.UnityEngine.Time.realtimeSinceStartup - start > 90) {
                trace("restore-timeout", s);
                throw new Error("The original save reload did not finish within 90 seconds");
            }
            if (!await U.Delay(100, "SingleSpaceReset")) throw new Error("Save reload was interrupted");
        }
    }

    Run.CanResetCurrentSpace = canReset;
    Run.ResetCurrentSpace = async function ResetCurrentSpace() {
        if (!canReset()) return false;
        busy = true;
        const oldJs = Battle.Instance;
        const oldRun = Run.SilentInstance;
        const slot = Archive.ActiveSlot;
        const stage = oldJs.Battle.BattleContextBase.Stage;
        const global = Global.Instance;
        const previousTip = Loading.showTip;
        const audio = U.GetSingleton(Cs.NOAH.Criware.CriwareAudioManager);
        const previousMute = audio.ScriptMute;
        let mask;
        let loading;
        let originalWaitTips;
        const skipTips = async () => {};
        let reloadTask;
        let quit = false;
        try {
            // Check the local save model without committing live combat damage.
            const response = await global.Request(Api.ClientApiBreedDungeon.ApiBreedDungeon).GetAsync();
            if (response.err || !response.res?.breedDungeonInfo) throw new Error("Could not read the current save");
            validateSnapshot(response.res.breedDungeonInfo, oldRun, stage);
            await oldJs.Preloader.stagePreloadPromise;
            if (Battle.Instance !== oldJs || Run.SilentInstance !== oldRun || Archive.ActiveSlot !== slot ||
                oldRun.currentRoom.finished || Cs.PvpDefine.IsOnlineMode()) {
                throw new Error("The active combat room changed while preparing reset");
            }
            trace("begin", { stage });
            mask = playTransition("Load");
            if (!await U.Delay(400, "SingleSpaceReset")) throw new Error("Reset transition was interrupted");
            Loading.showTip = false;
            loading = UI.FindWindow(Loading) || await UI.AcquireWindowAsync(Loading);
            loading.SetupTips();
            await loading.ShowBlackLoading();
            // Remove only the cosmetic minimum tip-display delay for this window.
            originalWaitTips = loading.WaitTips;
            loading.WaitTips = skipTips;
            stopTransition(mask);
            mask = null;
            if (Battle.Instance !== oldJs || RunBase.Instance !== oldRun ||
                Archive.ActiveSlot !== slot || oldRun.currentRoom.finished ||
                oldRun.currentRoom.stageIdx !== stage || Cs.PvpDefine.IsOnlineMode()) {
                throw new Error("The active combat room changed during the transition");
            }

            // Same order as PDAssistant.OnBackClick. QuitAsync destroys the run;
            // it does NOT abandon the dungeon or upload the current battle state.
            UI.RecycleWindowByName("PDAssistant", true);
            await RunBase.Instance.QuitAsync();
            quit = true;
            Save.Instance.ManualSave();
            Data.ResetDataBinding();
            U.SetAllActionLock(false);
            trace("quit-saved");

            // Original helper loads SceneLogin and immediately calls Login.StartGame.
            // Keep native scene exit, LoadData, full OnLoginSuccess and normal
            // CreateBattleEx. They own input/HUD setup and resource retainer transfer.
            const reload = global.ForceReloadGame();
            reloadTask = global.loadingPromise;
            await reload;
            trace("auto-login-started");
            const restored = await waitForRestore(oldJs, oldRun, stage, slot);
            playTransition("Out");
            trace("complete", restored);
            return true;
        } catch (error) {
            trace("error", { message: error?.stack || String(error), quit });
            // ForceReloadGame lacks a finally in the original game. Repair only
            // its rejected task; never clear a later scene/preload operation.
            if (reloadTask && global.loadingPromise === reloadTask) {
                try { await reloadTask; } catch (_) { global.loadingPromise = null; }
            }
            if (!global.loadingPromise && !Preloader.loadBattleExLock &&
                ((!quit && Battle.Instance === oldJs) ||
                Cs.UnityEngine.SceneManagement.SceneManager.GetActiveScene().name === "SceneLogin")) {
                await UI.FindWindow(Loading)?.FadeOut();
            }
            Windows.QueueMessages(quit ? "自动重新进入存档失败，请在主菜单继续游戏。" : "未能重置空间，请稍后重试。");
            return false;
        } finally {
            if (loading?.WaitTips === skipTips) loading.WaitTips = originalWaitTips;
            Loading.showTip = previousTip;
            audio.ScriptMute = previousMute;
            stopTransition(mask);
            busy = false;
        }
    };

    const init = Menu.prototype.InitWindow;
    Menu.prototype.InitWindow = function () {
        const result = init.apply(this, arguments);
        if (this.curMode === "BattleBreed") {
            const node = this.R.NodeTeamBreedReset;
            if (node) {
                const visible = canReset();
                node.gameObject.SetActive(visible);
                if (visible) {
                    if (!this.listBtn.some(entry => entry.t === node.transform)) {
                        this.listBtn.push({ t: node.transform, order: 190 });
                    }
                    this.SortBtnOrder();
                }
            }
        }
        return result;
    };
    const teamReset = Menu.prototype.OnTeamBreedResetClick;
    Menu.prototype.OnTeamBreedResetClick = function () {
        if (this.curMode === "BattleBreed") return Run.ResetCurrentSpace();
        return teamReset.apply(this, arguments);
    };
    trace("menu patch v0.1.5 loaded");
})();
