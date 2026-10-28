// Appended to Widget/MiscSettingsWidget; available from main-menu settings too.
;(() => {
    "use strict";
    const Settings = exports.default;
    const Cs = require("csharp");
    const U = require("Core/Util").U;
    const UI = require("Core/UIUtil").default;
    const KEY = "SingleSpaceReset.RerollNormalRoom";
    const TITLE = "重置时随机普通房间";
    const DETAIL = "开启后，仅单人模式的非 Boss 战斗房间在重置时从当前层级重新抽取地图布局。保留房间奖励和战斗类别，角色按原有重置规则恢复，不保存重置前的受伤和消耗。没有可用候选时保留原地图；多人模式和 Boss 房间不受影响。";
    if (Settings.__singleSpaceSettingsV7) return;
    Settings.__singleSpaceSettingsV7 = true;
    Settings.IsSingleSpaceRerollEnabled = () => Cs.UnityEngine.PlayerPrefs.GetInt(KEY, 0) === 1;
    Settings.SetSingleSpaceRerollEnabled = enabled => {
        Cs.UnityEngine.PlayerPrefs.SetInt(KEY, enabled ? 1 : 0);
        Cs.UnityEngine.PlayerPrefs.Save();
    };
    function refresh(widget) {
        const row = widget.__singleSpaceRerollRow;
        if (!row) return;
        row.syncing = true;
        try { row.switcher.Value = Settings.IsSingleSpaceRerollEnabled() ? 1 : 0; }
        finally { row.syncing = false; }
    }
    function createRow(widget) {
        if (widget.__singleSpaceRerollRow) return;
        const refs = widget.R;
        // Clone before the original Awake binds the source switcher's delegates.
        const node = Cs.UnityEngine.Object.Instantiate(refs.HideCursorWhenFight, refs.Content);
        node.name = "SingleSpaceRerollNormalRoom";
        node.gameObject.SetActive(false);
        node.SetSiblingIndex(refs.HideCursorWhenFight.GetSiblingIndex() + 1);
        const labelNode = node.Find("Name");
        const locale = U.GetComponent(labelNode, Cs.NOAH.UI.UILocale);
        if (locale) locale.enabled = false;
        U.GetComponent(labelNode, Cs.TMPro.TextMeshProUGUI).TextAuto(TITLE);
        const switcher = U.GetComponent(node.Find("HideCursorWhenFightSwitcher"), Cs.NOAH.UI.Switcher);
        switcher.name = "SingleSpaceRerollSwitcher";
        const List = puerts.$generic(Cs.System.Collections.Generic.List$1, Cs.System.String);
        const options = new List();
        options.Add(U.GetLocale("OFF")); options.Add(U.GetLocale("ON"));
        switcher.ClearOptions(); switcher.AddOptions(options);
        const row = widget.__singleSpaceRerollRow = { node, switcher, syncing: false };
        refresh(widget);
        UI.BindSwitchEvent(switcher, value => {
            if (!row.syncing) Settings.SetSingleSpaceRerollEnabled(value === 1);
        });
        UI.BindSelectEvent(switcher, () => {
            refs.SettingDetail.gameObject.SetActive(true);
            refs.DetailTitleText.TextAuto(TITLE);
            refs.DetailContentText.TextAuto(DETAIL);
        });
    }
    const awake = Settings.prototype.Awake;
    Settings.prototype.Awake = function () {
        createRow(this);
        const result = awake.apply(this, arguments);
        this.__singleSpaceRerollRow.node.gameObject.SetActive(true);
        return result;
    };
    for (const name of ["OnEnable", "UpdateMiscSettings"]) {
        const original = Settings.prototype[name];
        Settings.prototype[name] = function () {
            const result = original.apply(this, arguments);
            refresh(this);
            return result;
        };
    }
    const defaults = Settings.prototype.SetToDefault;
    Settings.prototype.SetToDefault = function () {
        const result = defaults.apply(this, arguments);
        Settings.SetSingleSpaceRerollEnabled(false);
        refresh(this);
        return result;
    };
})();
