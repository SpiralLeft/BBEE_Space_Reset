// Synthetic host objects only; no extracted game code or player saves.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'single-space-reset.js'), 'utf8');

function host(options = {}) {
    let time = 0;
    const events = [], logs = [], disk = [];
    const Archive = { ActiveSlot: 1 };
    const room = { stageIdx: 'synthetic/room1', roomType: 1, finished: false };
    const model = {
        baseInfo: { id: 12, seed: 456, currentPhase: 1, dead: false,
            phases: [{ phaseIndex: 1, currentStageIndex: 1, finished: false, rooms: [room] }] },
        actorInfo: { fesActor: { id: 34, activeAttrs: [{ type: 1, value: 0.6 },
            { type: 2, value: 40 }, { type: 3, value: 1 }, { type: 4, value: 0 }] } }
    };
    const Run = {}, RunBase = {}, Battle = {};
    const Preloader = { AdditinalLoadFuncs: [] };
    const Data = { DB: { Battle: { BattleUIOpen: { Value: true } } },
        ResetDataBinding() { events.push('reset-binding'); } };
    const audio = { ScriptMute: false };
    const manager = { IsInBattle: true, ActorActionFlag: 0, UIActionFlag: 0 };
    class Loading {
        static showTip = true;
        SetupTips() {}
        async ShowBlackLoading() {}
        async WaitTips() {}
        async FadeOut() { loading = null; }
    }
    let loading = null;
    const UI = { UIManagerInstance: { WindowOverlay: {} },
        FindWindow: () => loading,
        async AcquireWindowAsync() { return loading = new Loading(); },
        RecycleWindowByName() { events.push('close-menu'); } };
    const U = { FpToFloat: x => x, FloatToFp: x => x, GetSingleton: x => x,
        SetAllActionLock() {}, async Delay(ms) { time += ms / 1000; return true; } };
    class BreedBattle {
        NotifyBattleStart() {
            events.push('original-start');
        }
    }
    const originalNotify = BreedBattle.prototype.NotifyBattleStart;
    class Menu { InitWindow() {} OnTeamBreedResetClick() { return 'multiplayer'; } }
    function newRun() {
        const phase = model.baseInfo.phases.at(-1);
        return { dungeon: model, dungeonId: 12, currentPhase: 1, currentStageIndex: phase.currentStageIndex,
            curPhaseInfo: phase, currentRoom: phase.rooms[phase.currentStageIndex - 1],
            async QuitAsync() { events.push('quit'); Run.SilentInstance = RunBase.Instance = null; } };
    }
    function newBattle(hp, attrs = model.actorInfo.fesActor.activeAttrs) {
        const js = new BreedBattle();
        const values = Object.fromEntries(attrs.map(a => [a.type, a.value]));
        const attr = { HP: hp, MaxHp: options.maxHp ?? 100, MP: values[2],
            HealthFlaskUseCount: values[3], RebornUseCount: values[4], IsHPZero: false,
            SetHP() { assert.fail('Mod must not correct HP after original loading'); } };
        if (options.forbidLiveRead) {
            for (const name of ['HP', 'MaxHp', 'MP', 'HealthFlaskUseCount', 'RebornUseCount']) {
                Object.defineProperty(attr, name, { get() { assert.fail('Mod read live state: ' + name); } });
            }
        }
        Object.assign(js, { BattleClassName: 'BattleBreed', PauseCount: 1,
            Preloader: { stagePreloadPromise: Promise.resolve() },
            Battle: { BattleContextBase: { Stage: Run.SilentInstance.currentRoom.stageIdx }, BattleState: 1,
                PlayerSelf: { Attr: attr,
                    Input: { IsInputCmdBlock: () => false } } },
            UIMain: { CsObj: { gameObject: { activeInHierarchy: true } },
                R: { SelfStatus: { gameObject: { activeInHierarchy: true } }, HiddenConent: { alpha: 1 } } } });
        return js;
    }
    Run.SilentInstance = RunBase.Instance = newRun();
    Battle.Instance = newBattle(70);
    const Save = { Instance: { ManualSave() {
        events.push('save'); disk.push(JSON.parse(JSON.stringify(model)));
    } } };
    const Global = { Instance: {
        Request() { return { async GetAsync() { return { res: { breedDungeonInfo: model } }; } }; },
        async ForceReloadGame() {
            events.push('load');
            const saved = disk.at(-1);
            assert.ok(saved, 'Original save must precede reload');
            const attrs = saved.actorInfo.fesActor.activeAttrs;
            const ratio = attrs.find(a => a.type === 1)?.value ?? 1;
            Run.SilentInstance = RunBase.Instance = newRun();
            Battle.Instance = newBattle(ratio * (options.maxHp ?? 100), attrs);
            Battle.Instance.NotifyBattleStart();
            loading = null;
        }
    } };
    const Cs = { EAttrType: { Hp: 1 }, PvpDefine: { IsOnlineMode: () => !!options.online },
        GamePlay: { BattleState: { Run: 1 }, GameInputManager: manager,
            InputCmd: { Attack: 1, Jump: 2, Dash: 3 } },
        SettingsManager: { MiscSettings: { BattleUIOpen: true } },
        UnityEngine: { Application: { dataPath: 'synthetic/data' },
            Time: { get realtimeSinceStartup() { return time; } },
            SceneManagement: { SceneManager: { GetActiveScene: () => ({ name: 'SceneFight' }) } } },
        NOAH: { VFX: { EffectPlayParam: class {}, VFXManager: { PlayEffect: () => ({ Stop() {} }) } },
            Criware: { CriwareAudioManager: audio } },
        System: { IO: { Directory: { CreateDirectory() {} }, File: {
            AppendAllText(_, line) { logs.push(JSON.parse(line)); } } } } };
    const modules = {
        'GamePlay/BattleBreedRun/BattleBreedRun': { default: Run },
        'GamePlay/Battle/BattleRunBase': { BattleRunBase: RunBase },
        'GamePlay/Battle/BattleJs': { default: Battle },
        'GamePlay/Battle/BattleBreed': { default: BreedBattle },
        'GamePlay/Battle/BattlePreloader': { default: Preloader },
        'GamePlay/BattleBreedRun/BattleBreedRunDefine': { BattleBreedRunDefine: { IsFightRoomType: t => t === 1 } },
        'Server/Struct/ClientRequestStruct': { ClientApiBreedDungeon: { ApiBreedDungeon: {} } },
        'Manager/TsGameGlobal': Global, 'Manager/TsDataSaveManager': { default: Save },
        'Archive/ArchiveEnv': { default: Archive }, 'DataBinding': Data,
        'Core/UIUtil': { default: UI }, 'Core/WindowUtil': { default: { QueueMessages: m => events.push(m) } },
        'Window/Loading': { default: Loading }, 'Core/Util': { U }, csharp: Cs
    };
    modules['Manager/TsGameGlobal'] = { default: Global };
    modules['Manager/TsDataSaveManager'] = { default: Save };
    vm.runInNewContext(source, { require(name) {
        assert.ok(name in modules, `Unmocked dependency ${name}`); return modules[name];
    }, exports: { default: Menu }, console: { info() {} } });
    assert.equal(BreedBattle.prototype.NotifyBattleStart, originalNotify, 'Original room-start hook must remain intact');
    return { Run, RunBase, Battle, Archive, model, events, logs, disk, newRun, newBattle,
        start() { Battle.Instance.NotifyBattleStart(); },
        hp() { return Battle.Instance.Battle.PlayerSelf.Attr.HP; },
        damage(hp) { Battle.Instance.Battle.PlayerSelf.Attr.HP = hp; },
        reset: () => Run.ResetCurrentSpace() };
}

test('original saved attributes survive damage and repeated resets without live-state upload', async () => {
    const h = host();
    const original = JSON.stringify(h.model);
    h.start();
    h.damage(15);
    Object.assign(h.Battle.Instance.Battle.PlayerSelf.Attr, { MP: 3, HealthFlaskUseCount: 4, RebornUseCount: 2 });
    assert.equal(await h.reset(), true);
    assert.equal(h.hp(), 60);
    const attr = h.Battle.Instance.Battle.PlayerSelf.Attr;
    assert.equal(attr.MP, 40); assert.equal(attr.HealthFlaskUseCount, 1); assert.equal(attr.RebornUseCount, 0);
    h.damage(25);
    assert.equal(await h.reset(), true);
    assert.equal(h.hp(), 60);
    assert.equal(h.disk.length, 2);
    assert.equal(JSON.stringify(h.model), original);
    for (const saved of h.disk) assert.equal(JSON.stringify(saved), original);
    const ordered = h.events.filter(e => ['quit', 'save', 'reset-binding', 'load'].includes(e));
    assert.deepEqual(ordered.slice(0, 4), ['quit', 'save', 'reset-binding', 'load']);
    assert.equal(h.logs.filter(e => e.event === 'complete').length, 2);
});

test('reset never reads live character attributes or adds a room-start observer', async () => {
    const h = host({ forbidLiveRead: true }); h.start();
    assert.equal(await h.reset(), true);
    assert.equal(h.events.filter(e => e === 'original-start').length, 2);
    assert.equal(h.logs.some(e => 'hp' in e || 'maxHp' in e || e.event.startsWith('health-')), false);
});

test('next room uses its original model state even when the map name is unchanged', async () => {
    const h = host(); h.start();
    const phase = h.model.baseInfo.phases[0];
    phase.rooms.push({ ...phase.rooms[0] }); phase.currentStageIndex = 2;
    h.Run.SilentInstance.currentStageIndex = 2;
    h.Run.SilentInstance.currentRoom = phase.rooms[1];
    h.model.actorInfo.fesActor.activeAttrs[0].value = 0.45;
    h.damage(45); h.start(); h.damage(9);
    assert.equal(await h.reset(), true); assert.equal(h.hp(), 45);
});

test('original HP ratio and maximum HP determine restored HP', async () => {
    const h = host({ maxHp: 200 }); h.damage(5);
    assert.equal(await h.reset(), true); assert.equal(h.hp(), 120);
});

test('changing save model does not reuse any earlier HP checkpoint', async () => {
    const h = host(); h.start(); h.Archive.ActiveSlot = 2;
    h.model.actorInfo.fesActor.activeAttrs[0].value = 0.3;
    assert.equal(await h.reset(), true); assert.equal(h.hp(), 30);
});

test('Mod delegates absent HP attributes to original loading defaults', async () => {
    const h = host(); h.model.actorInfo.fesActor.activeAttrs = [];
    assert.equal(await h.reset(), true); assert.equal(h.hp(), 100);
});

test('mismatched saved room aborts before quit/save', async () => {
    const h = host();
    h.Run.SilentInstance.currentStageIndex = 2;
    assert.equal(await h.reset(), false);
    assert.equal(h.disk.length, 0); assert.equal(h.events.includes('quit'), false);
});

test('multiplayer does not invoke the single-player save/load path', async () => {
    const h = host({ online: true }); h.start();
    assert.equal(await h.reset(), false);
    assert.equal(h.logs.some(e => e.event === 'health-checkpoint'), false);
    assert.equal(h.disk.length, 0);
});
