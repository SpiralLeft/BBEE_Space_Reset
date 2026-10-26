// Appended to Window/PDAssistant. Restart the room inside the existing battle.
;(() => {
    "use strict";
    const Run = require("GamePlay/BattleBreedRun/BattleBreedRun").default;
    const RunBase = require("GamePlay/Battle/BattleRunBase").BattleRunBase;
    const Battle = require("GamePlay/Battle/BattleJs").default;
    const Preloader = require("GamePlay/Battle/BattlePreloader").default;
    const Define = require("GamePlay/BattleBreedRun/BattleBreedRunDefine").BattleBreedRunDefine;
    const Api = require("Server/Struct/ClientRequestStruct");
    const Global = require("Manager/TsGameGlobal").default;
    const StageMode = require("GamePlay/BattleBreedRun/BattleBreedRunBase").BattleBreedStageInitType;
    const BlessGraph = require("Widget/WidgetActorBlessGraph").default;
    const Archive = require("Archive/ArchiveEnv").default;
    const Data = require("DataBinding");
    const UI = require("Core/UIUtil").default;
    const Windows = require("Core/WindowUtil").default;
    const Loading = require("Window/Loading").default;
    const U = require("Core/Util").U;
    const Cs = require("csharp");
    const Menu = exports.default;
    if (Menu.prototype.__singleSpaceResetV6) return;
    Menu.prototype.__singleSpaceResetV6 = true;
    let busy = false;

    function trace(event, detail = {}) {
        const line = JSON.stringify({ time: new Date().toISOString(), version: "0.1.6", event, ...detail });
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
            !js.BossDieShowing && js.PauseCount <= 1 && !!js.Preloader && !!js.UIMain &&
            !Preloader.loadBattleExLock && !Preloader.ExistingOldPreloader &&
            Preloader.AdditinalLoadFuncs.length === 0 &&
            !Global.Instance.loadingPromise &&
            Cs.UnityEngine.SceneManagement.SceneManager.GetActiveScene().name === "SceneFight";
    }

    function validateSnapshot(dungeon, run, stage) {
        const phases = dungeon?.baseInfo?.phases;
        const phase = phases?.[phases.length - 1];
        const room = phase?.rooms?.[phase.currentStageIndex - 1];
        if (!dungeon?.actorInfo?.fesActor || dungeon.baseInfo.dead ||
            dungeon.baseInfo.id !== run.dungeonId ||
            dungeon.baseInfo.seed !== run.dungeon.baseInfo.seed ||
            dungeon.actorInfo.fesActor.id !== run.dungeon.actorInfo.fesActor.id ||
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
            pauseCount: js?.PauseCount,
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

    async function waitForEntry(js, run, stage, slot, player, phase, roomIndex) {
        const start = Cs.UnityEngine.Time.realtimeSinceStartup;
        let stable = 0;
        for (;;) {
            if (Archive.ActiveSlot !== slot || Battle.Instance !== js || Run.SilentInstance !== run ||
                RunBase.Instance !== run || Cs.PvpDefine.IsOnlineMode() ||
                js.Battle?.PlayerSelf !== player || run.currentRoom.stageIdx !== stage ||
                run.currentPhase !== phase || run.currentStageIndex !== roomIndex) {
                throw new Error("The active battle changed during room entry");
            }
            const s = state();
            const ready = s.scene === "SceneFight" && s.stage === stage &&
                s.battleState === Cs.GamePlay.BattleState.Run && s.pauseCount === 0 && s.inBattle &&
                s.actorFlags === 0 && s.uiFlags === 0 &&
                s.attackBlocked === false && s.jumpBlocked === false && s.dashBlocked === false &&
                s.hudActive && (!s.hudSetting || (s.statusActive && s.hudAlpha > 0)) &&
                !s.loading && !Global.Instance.loadingPromise && !Preloader.loadBattleExLock &&
                s.preloadCallbacks === 0;
            if (ready && ++stable >= 3) return s;
            if (!ready) stable = 0;
            if (Cs.UnityEngine.Time.realtimeSinceStartup - start > 30) {
                trace("entry-timeout", s);
                throw new Error("The room entry did not finish within 30 seconds");
            }
            if (!await U.Delay(100, "SingleSpaceReset")) throw new Error("Room entry was interrupted");
        }
    }

    Run.CanResetCurrentSpace = canReset;
    Run.ResetCurrentSpace = async function ResetCurrentSpace() {
        if (!canReset()) return false;
        busy = true;
        const js = Battle.Instance;
        const run = Run.SilentInstance;
        const battle = js.Battle;
        const preloader = js.Preloader;
        const hud = js.UIMain;
        const slot = Archive.ActiveSlot;
        const stage = battle.BattleContextBase.Stage;
        const phase = run.currentPhase;
        const roomIndex = run.currentStageIndex;
        const oldPlayer = battle.PlayerSelf;
        const started = Cs.UnityEngine.Time.realtimeSinceStartup;
        const inputLock = Cs.NOAH.Input.LockFlag.AsyncLoading;
        let mask;
        let locked = false;
        let changed = false;
        let oldTimeScale;
        let frozen = false;
        let transitionOut = false;
        function checkCurrent(snapshot) {
            if (Battle.Instance !== js || js.Battle !== battle || Run.SilentInstance !== run ||
                RunBase.Instance !== run || Archive.ActiveSlot !== slot ||
                run.currentPhase !== phase || run.currentStageIndex !== roomIndex ||
                run.isVirtualStage || run.curPhaseInfo.finished || run.currentRoom.finished ||
                run.currentRoom.stageIdx !== stage || run.dungeon.baseInfo.dead ||
                Cs.UnityEngine.SceneManagement.SceneManager.GetActiveScene().name !== "SceneFight" ||
                battle.PlayerSelf !== oldPlayer || oldPlayer.Attr.IsHPZero ||
                battle.BattleState !== Cs.GamePlay.BattleState.Run ||
                js.PauseCount > 1 || js.BossDieShowing || js.Preloader !== preloader ||
                js.UIMain !== hud || Global.Instance.loadingPromise ||
                Preloader.loadBattleExLock || Preloader.ExistingOldPreloader ||
                Preloader.AdditinalLoadFuncs.length !== 0 ||
                Cs.PvpDefine.IsOnlineMode()) {
                throw new Error("The active combat room changed while preparing reset");
            }
            validateSnapshot(snapshot, run, stage);
        }
        try {
            // GET returns the local dungeon model, not the damaged live player.
            // Never call the multiplayer reset/sync, room-enter, load or save APIs.
            const response = await Global.Instance.Request(Api.ClientApiBreedDungeon.ApiBreedDungeon).GetAsync();
            if (response.err || !response.res?.breedDungeonInfo) throw new Error("Could not read the current dungeon model");
            const snapshot = U.DeepCopy(response.res.breedDungeonInfo);
            checkCurrent(snapshot);
            await preloader.stagePreloadPromise;
            checkCurrent(snapshot);
            trace("begin", { stage, phase, roomIndex, path: "in-place" });
            U.SetAllActionLock(true, inputLock);
            locked = true;
            UI.RecycleWindowByName("PDAssistant", true);
            oldTimeScale = battle.TimeScale;
            battle.TimeScale = 0;
            frozen = true;
            mask = playTransition("Load");
            if (!await U.Delay(400, "SingleSpaceReset")) throw new Error("Reset transition was interrupted");
            checkCurrent(snapshot);

            // Preserve Battle, UI/InputGroup and the resource managers/retainer.
            // Unlike multiplayer (which keeps its players), discard the old
            // player and all its summons/bullets before original model loading.
            changed = true;
            js.ExitAllProcs();
            js.ExitAll();
            battle.SetBattleState(Cs.GamePlay.BattleState.NotStart);
            battle.KillAllEnemyPlayersQuiet(true);
            const summons = battle.PlayerObjMgr.FindPlayersByCaster(oldPlayer);
            const owned = [];
            for (let i = 0; i < summons.Count; i++) owned.push(summons.get_Item(i));
            for (const summon of owned) {
                if (summon !== oldPlayer) summon.DeactivateOnDeadEnd();
            }
            battle.BulletMgr.RemoveAllBullets(false);
            battle.BattleScene?.StopAllFullScreenEffect(true);
            battle.RemovePlayerSelf();
            js.ItemDropManager.Clear();
            run.enterData = { ...run.enterData, dungeon: snapshot,
                phaseInfo: snapshot.baseInfo.phases[snapshot.baseInfo.phases.length - 1] };
            run.initStageMode = StageMode.Normal;
            BlessGraph.BlessesChecked = snapshot.activeInfo?.blessesChecked ?? [];
            js.UsedBlesses = [];
            js.StagePerfectPass = false;
            js.BossKillPerfect = false;
            js.lastMonsterDiePos = null;
            js.m_DungeonActiveInfo = undefined;
            js.m_TimeTipType = 0;
            js.refreshHeatStatus();
            // Same map: EnterStage owns native scene cleanup, BLL/spawn reset
            // and time/statistics reset. No scene load or preloader handoff.
            battle.EnterStage(battle.BattleContextBase.Clone(), null, false);
            js.breedSelfPlayerLoad();
            const player = battle.PlayerSelf;
            if (!player || player === oldPlayer) throw new Error("The original player initialization failed");
            js.breedStagePreInit();
            js.commonStageInit();
            js.breedStageInit();
            js.ManualRefreshPlotFragNumber();
            js.SetFightUIVisible(true);
            js.SetBreedUIVisible(true);
            js.SetUIVisible(true);
            hud.HiddenUI(Data.DB.Battle.BattleUIOpen.Value);
            js.BreedUI?.ShowExpPanel(true);
            if (js.Preloader !== preloader || js.UIMain !== hud) throw new Error("Room reset replaced a retained owner");
            trace("room-rebuilt", { stage, retainedBattle: true, retainedUI: true, retainedPreloader: true });
            battle.TimeScale = oldTimeScale;
            frozen = false;
            stopTransition(mask);
            mask = null;
            playTransition("Out");
            transitionOut = true;
            U.SetAllActionLock(false, inputLock);
            locked = false;
            // Original entry owns its ScriptRequire/input blocks and boss entry.
            await js.enterWithAutoCheckBattleState();
            const ready = await waitForEntry(js, run, stage, slot, player, phase, roomIndex);
            trace("complete", { ...ready, elapsedMs: Math.round(
                (Cs.UnityEngine.Time.realtimeSinceStartup - started) * 1000) });
            return true;
        } catch (error) {
            trace("error", { message: error?.stack || String(error), changed });
            Windows.QueueMessages(changed ? "重置空间失败，请返回主菜单后继续游戏。" : "未能重置空间，请稍后重试。");
            return false;
        } finally {
            try {
                if (Battle.Instance === js && js.Battle === battle && frozen) {
                    battle.TimeScale = oldTimeScale;
                }
                if (locked) U.SetAllActionLock(false, inputLock);
                stopTransition(mask);
                if (mask && !transitionOut) playTransition("Out");
            } finally { busy = false; }
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
    trace("menu patch v0.1.6 loaded");
})();
