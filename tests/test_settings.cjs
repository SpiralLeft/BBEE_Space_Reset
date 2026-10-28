// Synthetic Unity settings hierarchy; no game assets are distributed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'reset-room-settings.js'), 'utf8');

function host(prefs = new Map()) {
    let saves = 0, clones = 0;
    const events = [];
    const type = name => ({ name });
    const types = { locale: type('locale'), text: type('text'), switcher: type('switcher') };
    function switcher() {
        return { options: [], _value: 0, change: null,
            ClearOptions() { this.options = []; }, AddOptions(options) { this.options.push(...options.values); },
            set Value(value) { this._value = value; this.change?.(value); }, get Value() { return this._value; } };
    }
    const sourceSwitcher = switcher();
    const refs = { Content: {}, HideCursorWhenFight: { GetSiblingIndex: () => 3 },
        SettingDetail: { gameObject: { SetActive(value) { this.active = value; } } },
        DetailTitleText: { TextAuto(text) { this.text = text; } },
        DetailContentText: { TextAuto(text) { this.text = text; } } };
    function clone() {
        clones++;
        assert.equal(sourceSwitcher.change, null, 'Clone before original Awake registers source callbacks');
        const locale = { enabled: true }, label = { TextAuto(text) { this.text = text; } };
        const sw = switcher();
        const children = { Name: { components: new Map([[types.locale, locale], [types.text, label]]) },
            HideCursorWhenFightSwitcher: { components: new Map([[types.switcher, sw]]) } };
        return { children, label, locale, switcher: sw,
            gameObject: { SetActive(value) { this.active = value; } },
            SetSiblingIndex(index) { this.index = index; }, Find: name => children[name] };
    }
    const UI = { BindSwitchEvent(sw, callback) { sw.change = callback; },
        BindSelectEvent(sw, callback) { sw.select = callback; } };
    class Settings {
        constructor() { this.R = refs; }
        Awake() {
            events.push('awake');
            UI.BindSwitchEvent(sourceSwitcher, value => { refs.originalSetting = value; });
        }
        OnEnable() { events.push('enable'); }
        UpdateMiscSettings() { events.push('update'); }
        SetToDefault() { events.push('defaults'); this.UpdateMiscSettings(); }
    }
    class List { values = []; Add(value) { this.values.push(value); } }
    const Cs = { UnityEngine: { Object: { Instantiate: (original, parent) => {
        assert.equal(original, refs.HideCursorWhenFight); assert.equal(parent, refs.Content); return clone();
    } }, PlayerPrefs: { GetInt: (key, fallback) => prefs.get(key) ?? fallback,
        SetInt(key, value) { prefs.set(key, value); }, Save() { saves++; } } },
        NOAH: { UI: { UILocale: types.locale, Switcher: types.switcher } },
        TMPro: { TextMeshProUGUI: types.text }, System: { Collections: { Generic: { List$1: List } }, String: {} } };
    const U = { GetComponent: (node, component) => node.components.get(component), GetLocale: key => key };
    const exports = { default: Settings };
    vm.runInNewContext(source, { exports, require(name) {
        if (name === 'csharp') return Cs;
        if (name === 'Core/Util') return { U };
        if (name === 'Core/UIUtil') return { default: UI };
        throw Error(name);
    }, puerts: { $generic: () => List } });
    return { Settings, prefs, events, refs, sourceSwitcher, saves: () => saves, clones: () => clones,
        open() { const widget = new Settings(); widget.Awake(); widget.OnEnable(); return widget; } };
}

test('Other settings gains a separate default-off switch and explanatory detail', () => {
    const h = host(), widget = h.open(), row = widget.__singleSpaceRerollRow;
    assert.equal(h.Settings.IsSingleSpaceRerollEnabled(), false);
    assert.equal(row.switcher.Value, 0); assert.equal(row.node.gameObject.active, true);
    assert.equal(row.node.index, 4); assert.equal(row.node.locale.enabled, false);
    assert.equal(row.node.label.text, '重置时随机普通房间');
    assert.deepEqual(row.switcher.options, ['OFF', 'ON']);
    row.switcher.select();
    assert.equal(h.refs.SettingDetail.gameObject.active, true);
    assert.ok(h.refs.DetailContentText.text.includes('仅单人模式'));
    assert.ok(h.refs.DetailContentText.text.includes('Boss'));
    assert.equal(h.saves(), 0, 'Opening settings never writes the preference');
});

test('switch persists independently and never invokes the source setting', () => {
    const h = host(), widget = h.open(), row = widget.__singleSpaceRerollRow;
    row.switcher.Value = 1;
    assert.equal(h.Settings.IsSingleSpaceRerollEnabled(), true);
    assert.equal(h.saves(), 1); assert.equal(h.refs.originalSetting, undefined);
    const restarted = host(h.prefs), anotherWidget = restarted.open();
    assert.equal(anotherWidget.__singleSpaceRerollRow.switcher.Value, 1);
    assert.equal(restarted.saves(), 0);
    h.sourceSwitcher.Value = 1;
    assert.equal(h.refs.originalSetting, 1, 'Original setting still works');
    row.switcher.Value = 0;
    assert.equal(h.Settings.IsSingleSpaceRerollEnabled(), false);
});

test('reopening/refreshing settings creates no duplicates or preference writes', () => {
    const h = host(), widget = h.open();
    widget.__singleSpaceRerollRow.switcher.Value = 1;
    for (let i = 0; i < 3; i++) { widget.OnEnable(); widget.UpdateMiscSettings(); }
    assert.equal(h.clones(), 1); assert.equal(h.saves(), 1);
    assert.equal(widget.__singleSpaceRerollRow.switcher.Value, 1);
});

test('Restore defaults disables the option and refreshes the visible switch', () => {
    const h = host(), widget = h.open();
    widget.__singleSpaceRerollRow.switcher.Value = 1;
    widget.SetToDefault();
    assert.equal(h.Settings.IsSingleSpaceRerollEnabled(), false);
    assert.equal(widget.__singleSpaceRerollRow.switcher.Value, 0);
    assert.ok(h.events.includes('defaults'));
});
