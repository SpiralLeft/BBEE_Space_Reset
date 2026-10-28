// Synthetic host only: exercise retained owners, player lifecycle and model isolation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'single-space-reset.js'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}
function host(options = {}) {
    let time = 0, online = !!options.online;
    const events = [], logs = [], messages = [];
    const Archive = { ActiveSlot: 1 };
    const model = {
        baseInfo: { id: 12, seed: 456, currentPhase: 1, dead: false,
            phases: [{ phaseIndex: 1, currentStageIndex: 1, finished: false,
                theme: 7, rooms: [{ stageIdx: 'synthetic/room1', roomType: options.roomType ?? 1, finished: false }] }] },
        actorInfo: { fesActor: { id: 34, activeAttrs: [{ type: 1, value: 0.6 },
            { type: 2, value: 40 }, { type: 3, value: 1 }, { type: 4, value: 0 }] } },
        activeInfo: { blessesChecked: [8], combo: 4 }
    };
    const copy = x => JSON.parse(JSON.stringify(x));
    const phase = model.baseInfo.phases[0];
    const Run = {}, RunBase = {}, Battle = {};
    const Preloader = { AdditinalLoadFuncs: [], loadBattleExLock: false };
    const Data = { DB: { Battle: { BattleUIOpen: { Value: options.hud !== false } } } };
    const BlessGraph = {};
    const manager = { IsInBattle: true, ActorActionFlag: 0, UIActionFlag: 0 };
    const run = { enterData: { dungeon: copy(model) }, initStageMode: 2,
        get dungeon() { return this.enterData.dungeon; },
        get dungeonId() { return this.dungeon.baseInfo.id; },
        get currentPhase() { return this.dungeon.baseInfo.currentPhase; },
        get curPhaseInfo() { return this.enterData.phaseInfo; },
        get currentStageIndex() { return this.curPhaseInfo.currentStageIndex; },
        get currentRoom() { return this.curPhaseInfo.rooms[this.currentStageIndex - 1]; } };
    run.enterData.phaseInfo = run.dungeon.baseInfo.phases[0];
    Run.SilentInstance = RunBase.Instance = run;
    function playerFromModel() {
        const values = Object.fromEntries(run.dungeon.actorInfo.fesActor.activeAttrs.map(a => [a.type, a.value]));
        const attr = { HP: (values[1] ?? 1) * (options.maxHp ?? 100), MaxHp: options.maxHp ?? 100,
            MP: values[2] ?? 100, HealthFlaskUseCount: values[3] ?? 0,
            RebornUseCount: values[4] ?? 0, IsHPZero: false,
            SetHP() { assert.fail('Mod must not correct HP'); } };
        if (options.forbidLiveRead) {
            for (const name of ['HP', 'MaxHp', 'MP', 'HealthFlaskUseCount', 'RebornUseCount']) {
                Object.defineProperty(attr, name, { get() { assert.fail('Read live state: ' + name); } });
            }
        }
        return { Attr: attr, Input: { IsInputCmdBlock: () => false }, retired: false };
    }
    const RoomTypes = { Fight: 1, Elite: 2, SuperElite: 3, Boss: 4, FinalBoss: 5 };
    const candidates = options.candidates ?? ['synthetic/room1', 'synthetic/room2'];
    const conf = { roomType: phase.rooms[0].roomType, stageIndex: 1, stageList: candidates };
    const localModel = { IsMulti: !!options.modelOnline,
        get Id() { return model.baseInfo.id; },
        get currentPhaseIndex() { return model.baseInfo.currentPhase; },
        get currentPhaseInfo() { return model.baseInfo.phases.at(-1); },
        get currentRoom() { return this.currentPhaseInfo.rooms[this.currentPhaseInfo.currentStageIndex - 1]; },
        get currentRoomConf() { return conf; } };
    class Model {
        static Instance = localModel;
        randomStageIdx(selected) {
            events.push('roll-map');
            assert.equal(selected, conf);
            assert.equal(this.baseInfo.seed, 0);
            assert.equal(model.baseInfo.seed, 456, 'Do not overwrite saved seed');
            assert.equal(this.currentPhaseInfo.theme, 7);
            return options.invalidMap ? 'invalid' : candidates.find(s => s !== this.currentPhaseInfo.rooms.at(-1).stageIdx);
        }
    }
    const resourceOwner = { released: false };
    const preloader = { resourceOwner, stagePreloadPromise: options.preload ?? null,
        Release() { resourceOwner.released = true; assert.fail('Released retained resources'); },
        StartPreloadStage(stage) {
            events.push('preload:' + stage);
            this.stagePreloadPromise = options.mapPreloadFailure ? Promise.reject(Error('preload failed')) :
                options.mapPreload ?? Promise.resolve();
            return this.stagePreloadPromise;
        },
        async EndPreloadStage() {
            await this.stagePreloadPromise; this.stagePreloadPromise = null; events.push('preload-end');
        } };
    let boundPlayer;
    const hud = { CsObj: { gameObject: { activeInHierarchy: true } },
        R: { SelfStatus: { gameObject: { activeInHierarchy: true } }, HiddenConent: { alpha: options.hud === false ? 0 : 1 } },
        HiddenUI(visible) { this.R.HiddenConent.alpha = visible ? 1 : 0; },
        ShowPlayerStatus(player) { boundPlayer = player; events.push('bind-player-input'); } };
    let summons = [], bullets = [], drops = [], procs = [];
    function addRuntimeObjects() {
        summons = [{ DeactivateOnDeadEnd() { events.push('remove-summon'); summons = []; } }];
        bullets = ['old-bullet']; drops = ['old-loot']; procs = ['old-tip', 'old-check'];
    }
    addRuntimeObjects();
    const battle = { BattleContextBase: { Stage: phase.rooms[0].stageIdx,
            Clone() { return { ...this }; } }, BattleState: 1, TimeScale: 0,
        PlayerSelf: playerFromModel(),
        SetBattleState(value) { this.BattleState = value; },
        KillAllEnemyPlayersQuiet() { events.push('kill-enemies'); },
        PlayerObjMgr: { FindPlayersByCaster() { return { Count: summons.length, get_Item: i => summons[i] }; } },
        BulletMgr: { RemoveAllBullets() { bullets = []; events.push('remove-bullets'); } },
        BattleScene: { StopAllFullScreenEffect() {} },
        RemovePlayerSelf() { this.PlayerSelf.retired = true; this.PlayerSelf = null; events.push('remove-player'); },
        EnterStage(context, callback, gc) {
            assert.equal(gc, false);
            assert.equal(this.PlayerSelf, null, 'Remove live player before stage entry');
            assert.equal(bullets.length + drops.length + summons.length + procs.length, 0);
            assert.equal(manager.ActorActionFlag & 2, 2, 'Reset lock must cover mutation');
            events.push('enter-stage');
            if (options.failEnter) throw Error('synthetic stage failure');
            assert.equal(context.Stage, run.currentRoom.stageIdx);
            if (context.Stage !== this.BattleContextBase.Stage) {
                assert.ok(events.includes('preload:' + context.Stage));
                assert.ok(events.includes('preload-end'));
                assert.equal(localModel.currentRoom.stageIdx, context.Stage);
            }
            this.BattleContextBase.Stage = context.Stage;
            // Model native stage logic reset without replacing any resource owner.
            this.BattleState = 0;
        } };
    const js = { BattleClassName: 'BattleBreed', PauseCount: 1, Battle: battle,
        Preloader: preloader, UIMain: hud, UsedBlesses: [99], StagePerfectPass: true,
        ExitAllProcs() { procs = []; events.push('exit-procs'); }, ExitAll() { events.push('cancel-delays'); },
        ItemDropManager: { Clear() { drops = []; events.push('clear-drops'); } },
        refreshHeatStatus() {},
        breedSelfPlayerLoad() {
            events.push('load-player');
            battle.PlayerSelf = playerFromModel();
            procs = ['new-tip', 'new-check'];
            hud.ShowPlayerStatus(battle.PlayerSelf);
        },
        breedStagePreInit() { events.push('pre-init'); },
        commonStageInit() { events.push('common-init'); },
        breedStageInit() { events.push('breed-init'); },
        ManualRefreshPlotFragNumber() {}, SetFightUIVisible() {}, SetBreedUIVisible() {},
        SetUIVisible() {}, BreedUI: { ShowExpPanel() {} },
        async enterWithAutoCheckBattleState() {
            events.push('entry');
            assert.equal(manager.ActorActionFlag & 2, 0, 'Release only reset lock before original entry');
            if (options.entryFailure) throw Error('synthetic entry failure');
            manager.UIActionFlag |= 4;
            if (options.timeout) return;
            battle.BattleState = 1; manager.UIActionFlag &= ~4;
            events.push('original-start');
        } };
    Battle.Instance = js;
    const Global = { Instance: { Request(api) {
        assert.equal(api, 'get-dungeon');
        return { async GetAsync() { events.push('get-model');
            if (options.request) await options.request;
            return options.readError ? { err: true } : { res: { breedDungeonInfo: model } }; } };
    } } };
    const UI = { UIManagerInstance: { WindowOverlay: {} }, FindWindow: () => null,
        RecycleWindowByName(name, immediate) {
            assert.equal(name, 'PDAssistant'); assert.equal(immediate, true);
            events.push('close-menu'); js.PauseCount = 0; battle.TimeScale = 1;
        } };
    const U = { DeepCopy: copy, GetSingleton: x => x,
        SetAllActionLock(value, flag) {
            assert.equal(flag, 2, 'Never clear other lock owners');
            manager.ActorActionFlag = value ? manager.ActorActionFlag | flag : manager.ActorActionFlag & ~flag;
            manager.UIActionFlag = value ? manager.UIActionFlag | flag : manager.UIActionFlag & ~flag;
        }, async Delay(ms) {
            time += ms / 1000;
            if (options.onDelay) options.onDelay(ms, { Archive, js, run, manager });
            return options.interrupt !== ms;
        } };
    class Menu { InitWindow() {} OnTeamBreedResetClick() { events.push('team-reset'); return 'multiplayer'; } }
    const Cs = { PvpDefine: { IsOnlineMode: () => online },
        GamePlay: { BattleState: { NotStart: 0, Run: 1 }, GameInputManager: manager,
            InputCmd: { Attack: 1, Jump: 2, Dash: 3 } },
        UnityEngine: { Application: { dataPath: 'synthetic/data' },
            Time: { get realtimeSinceStartup() { return time; } },
            SceneManagement: { SceneManager: { GetActiveScene: () => ({ name: 'SceneFight' }) } } },
        NOAH: { Input: { LockFlag: { AsyncLoading: 2 } }, VFX: { EffectPlayParam: class {},
            VFXManager: { PlayEffect(p) { events.push(p.name); return { Stop() { events.push('stop-mask'); } }; } } } },
        System: { IO: { Directory: { CreateDirectory() {} },
            File: { AppendAllText(_, line) { logs.push(JSON.parse(line)); } } } } };
    const modules = {
        'GamePlay/BattleBreedRun/BattleBreedRun': { default: Run },
        'GamePlay/Battle/BattleRunBase': { BattleRunBase: RunBase },
        'GamePlay/Battle/BattleJs': { default: Battle },
        'GamePlay/Battle/BattlePreloader': { default: Preloader },
        'GamePlay/BattleBreedRun/BattleBreedRunDefine': { BattleBreedRunDefine: { IsFightRoomType: t => Object.values(RoomTypes).includes(t) } },
        'GamePlay/BattleBreedRun/BattleBreedRunBase': { BattleBreedStageInitType: { Normal: 0 } },
        'Widget/WidgetActorBlessGraph': { default: BlessGraph },
        'Server/Struct/ClientRequestStruct': { ClientApiBreedDungeon: { ApiBreedDungeon: 'get-dungeon' } },
        'Manager/TsGameGlobal': { default: Global }, 'Archive/ArchiveEnv': { default: Archive }, DataBinding: Data,
        'Core/UIUtil': { default: UI }, 'Core/WindowUtil': { default: { QueueMessages: m => messages.push(m) } },
        'Widget/MiscSettingsWidget': { default: { IsSingleSpaceRerollEnabled: () => !!options.reroll } },
        'Gen/pbdef': { EBreedDungeonRoomType: RoomTypes },
        'Server/Model/BreedDungeon': { ModelBreedDungeon: Model },
        'Gen/Xlsx': { Xlsx: { SceneStageBase: { Get: stage => candidates.includes(stage) ? { Idx: stage } : null } } },
        'Window/Loading': { default: class {} }, 'Core/Util': { U }, csharp: Cs
    };
    vm.runInNewContext(source, { require: name => {
        assert.ok(name in modules, 'Unexpected module: ' + name); return modules[name];
    }, exports: { default: Menu }, console: { info() {} }, Date });
    return { model, run, Battle, Run, RunBase, Archive, js, battle, preloader, hud, manager, Preloader,
        Global, BlessGraph, localModel, events, logs, messages,
        bound: () => boundPlayer, procs: () => procs, setOnline: v => { online = v; },
        hp: () => battle.PlayerSelf.Attr.HP, damage: hp => { battle.PlayerSelf.Attr.HP = hp; },
        populate: addRuntimeObjects, menu: () => new Menu(), reset: () => Run.ResetCurrentSpace() };
}

test('repeated in-place reset restores model attributes and retains battle/UI/resources', async () => {
    const h = host(); const original = JSON.stringify(h.model);
    for (let i = 0; i < 3; i++) {
        const oldPlayer = h.battle.PlayerSelf;
        h.damage(10 + i);
        Object.assign(oldPlayer.Attr, { MP: 0, HealthFlaskUseCount: 5, RebornUseCount: 2 });
        h.populate();
        assert.equal(await h.reset(), true);
        assert.equal(h.hp(), 60);
        assert.equal(oldPlayer.retired, true);
        assert.notEqual(h.battle.PlayerSelf, oldPlayer);
        assert.equal(h.bound(), h.battle.PlayerSelf);
        assert.equal(h.battle.PlayerSelf.Attr.MP, 40);
        assert.equal(h.battle.PlayerSelf.Attr.HealthFlaskUseCount, 1);
        assert.equal(h.battle.PlayerSelf.Attr.RebornUseCount, 0);
        assert.equal(h.Battle.Instance, h.js); assert.equal(h.Run.SilentInstance, h.run);
        assert.equal(h.js.UIMain, h.hud); assert.equal(h.js.Preloader, h.preloader);
        assert.equal(h.preloader.resourceOwner.released, false);
        assert.equal(h.procs().length, 2);
        assert.equal(h.manager.ActorActionFlag | h.manager.UIActionFlag, 0);
        assert.equal(h.battle.TimeScale, 1);
        assert.equal(JSON.stringify(h.model), original);
        assert.equal(h.js.UsedBlesses.length, 0);
        assert.equal(h.run.initStageMode, 0);
    }
    assert.equal(h.logs.filter(e => e.event === 'complete').length, 3);

});

test('no live attribute reads, HP correction, observer or write API dependency', async () => {
    const h = host({ forbidLiveRead: true });
    assert.equal(await h.reset(), true);
    assert.equal(h.logs.some(e => 'hp' in e || 'maxHp' in e), false);
    for (const forbidden of ['ForceReloadGame', 'ManualSave', 'ResetDataBinding', 'NotifyServerForRestore',
        '.PostAsync(', 'GetUploadActiveAttr', 'NotifyBattleStart =', '.SetHP(', 'CreateBattleEx', 'ExistingOldPreloader =']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('same-map next room and another save use their own model state', async () => {
    const h = host(); assert.equal(await h.reset(), true);
    for (const state of [{ slot: 1, index: 2, hp: .45 }, { slot: 2, index: 2, hp: .3 }]) {
        h.Archive.ActiveSlot = state.slot;
        for (const dungeon of [h.model, h.run.dungeon]) {
            const phase = dungeon.baseInfo.phases[0];
            if (phase.rooms.length < 2) phase.rooms.push({ ...phase.rooms[0] });
            phase.currentStageIndex = state.index;
        }
        h.model.actorInfo.fesActor.activeAttrs[0].value = state.hp;
        h.damage(1); assert.equal(await h.reset(), true); assert.equal(h.hp(), state.hp * 100);
    }
});

test('original HP ratio, maximum and missing-attribute defaults are delegated to loader', async () => {
    const h = host({ maxHp: 200 }); assert.equal(await h.reset(), true); assert.equal(h.hp(), 120);
    h.model.actorInfo.fesActor.activeAttrs = [];
    assert.equal(await h.reset(), true); assert.equal(h.hp(), 200);
});

test('HUD hidden setting stays hidden while input is rebound', async () => {
    const h = host({ hud: false }); assert.equal(await h.reset(), true);
    assert.equal(h.hud.R.HiddenConent.alpha, 0); assert.equal(h.bound(), h.battle.PlayerSelf);
});

test('multiplayer delegates to original menu and rejects direct single-player reset', async () => {
    const h = host({ online: true });
    assert.equal(await h.reset(), false);
    const menu = h.menu(); menu.curMode = 'BattleTeamBreed';
    assert.equal(menu.OnTeamBreedResetClick(), 'multiplayer');
    assert.deepEqual(h.events, ['team-reset']);
});

test('invalid model and failed read abort before touching room/player', async () => {
    for (const type of ['mismatch', 'seed', 'actor', 'finished', 'dead', 'read']) {
        const h = host({ readError: type === 'read' });
        if (type === 'mismatch') h.model.baseInfo.phases[0].currentStageIndex = 2;
        if (type === 'seed') h.model.baseInfo.seed++;
        if (type === 'actor') h.model.actorInfo.fesActor.id++;
        if (type === 'finished') h.model.baseInfo.phases[0].rooms[0].finished = true;
        if (type === 'dead') h.model.baseInfo.dead = true;
        const player = h.battle.PlayerSelf;
        assert.equal(await h.reset(), false, type);
        assert.equal(h.events.includes('enter-stage'), false);
        assert.equal(h.battle.PlayerSelf, player);
        assert.equal(h.manager.ActorActionFlag | h.manager.UIActionFlag, 0);
    }
});

test('preload wait prevents mutation and concurrent reset', async () => {
    const pending = deferred(); const h = host({ preload: pending.promise });
    const reset = h.reset(); await Promise.resolve(); await Promise.resolve();
    assert.equal(await h.reset(), false); assert.equal(h.events.includes('remove-player'), false);
    pending.resolve(); assert.equal(await reset, true);
});

test('save slot/room/online race aborts before mutation and releases owned lock', async () => {
    for (const race of ['slot', 'room', 'online']) {
        let h;
        h = host({ onDelay(ms) {
            if (ms !== 400) return;
            if (race === 'slot') h.Archive.ActiveSlot++;
            if (race === 'room') h.run.currentRoom.finished = true;
            if (race === 'online') h.setOnline(true);
        } });
        const player = h.battle.PlayerSelf;
        assert.equal(await h.reset(), false, race);
        assert.equal(h.battle.PlayerSelf, player); assert.equal(h.events.includes('enter-stage'), false);
        assert.equal(h.manager.ActorActionFlag | h.manager.UIActionFlag, 0);
        assert.equal(h.battle.TimeScale, 1);
    }
});

test('transition interruption allows retry without writing/retiring player', async () => {
    const options = { interrupt: 400 }; const h = host(options); const player = h.battle.PlayerSelf;
    assert.equal(await h.reset(), false); assert.equal(h.battle.PlayerSelf, player);
    options.interrupt = undefined;
    assert.equal(await h.reset(), true);
});

test('native failure and original entry timeout clear reset lock without automatic reload', async () => {
    for (const options of [{ failEnter: true }, { entryFailure: true }, { timeout: true }]) {
        const h = host(options), original = JSON.stringify(h.model);
        assert.equal(await h.reset(), false);
        assert.equal(h.manager.ActorActionFlag & 2, 0); assert.equal(h.manager.UIActionFlag & 2, 0);
        assert.equal(h.battle.TimeScale, 1); assert.equal(JSON.stringify(h.model), original);
        assert.equal(h.preloader.resourceOwner.released, false);
        assert.equal(h.messages.length, 1);
        if (options.timeout) {
            assert.ok(h.logs.some(e => e.event === 'entry-timeout'));
            assert.equal(h.manager.UIActionFlag & 4, 4, 'Never clear original entry lock');
        }
    }
});


test('enabled normal-room reset rerolls and preloads before mutation, changing only the room map', async () => {
    const h = host({ reroll: true, forbidLiveRead: true });
    const before = JSON.parse(JSON.stringify(h.model));
    assert.equal(await h.reset(), true);
    assert.equal(h.battle.BattleContextBase.Stage, 'synthetic/room2');
    assert.equal(h.run.currentRoom.stageIdx, 'synthetic/room2');
    const expected = JSON.parse(JSON.stringify(before));
    expected.baseInfo.phases[0].rooms[0].stageIdx = 'synthetic/room2';
    assert.deepEqual(h.model, expected);
    assert.ok(h.events.indexOf('preload-end') < h.events.indexOf('remove-player'));
    assert.ok(h.logs.some(e => e.event === 'room-rerolled'));
    assert.equal(await h.reset(), true, 'Repeated reset uses the newly selected map in the model');
    assert.equal(h.battle.BattleContextBase.Stage, 'synthetic/room1');
    assert.deepEqual(h.model.actorInfo, before.actorInfo);
    assert.equal(h.js.UIMain, h.hud); assert.equal(h.js.Preloader, h.preloader);
});

test('setting off and both boss types keep their original map and do not invoke RNG/preload', async () => {
    for (const options of [{}, { reroll: false }, { reroll: true, roomType: 4 }, { reroll: true, roomType: 5 }]) {
        const h = host(options), before = JSON.stringify(h.model);
        assert.equal(await h.reset(), true);
        assert.equal(h.events.includes('roll-map'), false);
        assert.equal(h.events.some(e => e.startsWith('preload:')), false);
        assert.equal(JSON.stringify(h.model), before);
    }
});

test('eligible non-boss battle categories use the same gated selector', async () => {
    for (const roomType of [1, 2, 3]) {
        const h = host({ reroll: true, roomType }); assert.equal(await h.reset(), true);
        assert.equal(h.model.baseInfo.phases[0].rooms[0].roomType, roomType);
        assert.equal(h.battle.BattleContextBase.Stage, 'synthetic/room2');
    }
});

test('online mode remains excluded even with reroll enabled', async () => {
    const h = host({ online: true, reroll: true });
    assert.equal(await h.reset(), false);
    assert.deepEqual(h.events, []);
});

test('single candidate or empty candidates retain the original room', async () => {
    for (const candidates of [[], ['synthetic/room1']]) {
        const h = host({ reroll: true, candidates });
        assert.equal(await h.reset(), true);
        assert.equal(h.battle.BattleContextBase.Stage, 'synthetic/room1');
        assert.equal(h.events.some(e => e.startsWith('preload:')), false);
    }
});

test('invalid selection/preload failure cannot change map or retire the current player', async () => {
    for (const extra of [{ invalidMap: true }, { mapPreloadFailure: true }]) {
        const options = { reroll: true, ...extra }, h = host(options);
        const before = JSON.stringify(h.model), player = h.battle.PlayerSelf;
        assert.equal(await h.reset(), false);
        assert.equal(h.battle.PlayerSelf, player);
        assert.equal(JSON.stringify(h.model), before);
        assert.equal(h.manager.ActorActionFlag | h.manager.UIActionFlag, 0);
        assert.equal(h.preloader.stagePreloadPromise, null);
        options.reroll = false;
        assert.equal(await h.reset(), true, 'Failed preparation must not poison later resets');
    }
});

test('reroll native entry failure rolls back selected model map without changing actor data', async () => {
    const h = host({ reroll: true, failEnter: true }), before = JSON.stringify(h.model);
    assert.equal(await h.reset(), false);
    assert.equal(JSON.stringify(h.model), before);
    assert.equal(h.manager.ActorActionFlag | h.manager.UIActionFlag, 0);
});

test('room changes during reroll preload abort before committing or replacing player', async () => {
    const pending = deferred(), options = { reroll: true, mapPreload: pending.promise };
    const h = host(options), player = h.battle.PlayerSelf;
    const task = h.reset();
    for (let i = 0; i < 10 && !h.events.includes('preload:synthetic/room2'); i++) await Promise.resolve();
    h.Archive.ActiveSlot = 2; pending.resolve();
    assert.equal(await task, false); assert.equal(h.battle.PlayerSelf, player);
    assert.equal(h.localModel.currentRoom.stageIdx, 'synthetic/room1');
    assert.equal(h.manager.ActorActionFlag | h.manager.UIActionFlag, 0);
});
