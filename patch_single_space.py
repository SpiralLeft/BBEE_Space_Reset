"""Build/install/restore reversible TextAsset patches in the merged Unity bundles.

Original bundles are never repacked in bulk. Installation appends rebuilt
bundles to existing merged files and changes only their start offsets in merge.json.
Full backups and hashes are kept before the first write; restore checks the
installed hashes before replacing patched files.
"""
import argparse
import hashlib
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STATE = ROOT / ".single-space-local"
sys.dont_write_bytecode = True
sys.path.insert(0, str(STATE / "deps"))

AB = ROOT / "BlazblueEntropyEffect_Data/StreamingAssets/ab"
BUILD = STATE / "build"
BACKUP = STATE / "original"
INSTALLED = STATE / "installed.json"
RESOURCE = "data/js/window/pdassistant.ab"
MARKER = b"menu patch v0.2.1 loaded"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def textasset(bundle):
    import UnityPy

    objects = [o for o in UnityPy.load(bundle).objects if o.type.name == "TextAsset"]
    if len(objects) != 1:
        raise ValueError("Expected one TextAsset")
    obj = objects[0].read()
    content = obj.m_Script
    return content.encode("utf-8", "surrogateescape") if isinstance(content, str) else content


def installed_evidence():
    path = INSTALLED if INSTALLED.exists() else BACKUP / "install.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def verify_current(evidence):
    for entry in evidence["files"]:
        actual = digest((AB / entry["name"]).read_bytes())
        if actual not in {entry["original_sha256"], entry["patched_sha256"]}:
            raise RuntimeError("Game updated or resources changed; refusing overwrite: " + entry["name"] +
                               ". For a supported game update, run rebase, then build and install.")


def rebase():
    """Adopt a verified game update without restoring the old resource manifest.

    This changes local installation state only. Known old appended patches may
    remain in game files until install, provided the new manifest points only
    into the verified original baseline. Unknown bytes are never adopted.
    """
    game_closed()
    supported = json.loads((HERE / "supported-game.json").read_text(encoding="utf-8"))
    manifest = (AB / "merge.json").read_bytes()
    manifest_hash = digest(manifest)
    baseline = next((b for b in supported.get("update_baselines", [])
                     if b["manifest_sha256"] == manifest_hash), None)
    if baseline is None:
        raise RuntimeError("Unknown game manifest; refusing to rebase. Use a supported clean game update.")
    existing = installed_evidence()
    if existing:
        # Do not archive a healthy installation or a baseline already adopted.
        try:
            verify_current(existing)
        except RuntimeError:
            pass
        else:
            print("Current installation already matches its baseline; run build and install.")
            return
    entries = json.loads(manifest)
    expected = baseline["files"]
    targets = [supported] + supported.get("additional_resources", [])
    target_files = {next(e["m"] for e in entries if e["r"] == t["resource"]) for t in targets}
    if target_files != set(expected):
        raise RuntimeError("Update baseline does not cover exactly the target merged files")
    old_files = {e["name"]: e for e in existing["files"]} if existing else {}
    if not set(old_files).issubset(target_files | {"merge.json"}):
        raise RuntimeError("Old installation includes other patched files; refusing to discard their restore state")
    originals, actuals = {"merge.json": manifest}, {"merge.json": manifest_hash}
    for name, expected_hash in expected.items():
        if Path(name).name != name or "/" in name or "\\" in name:
            raise RuntimeError("Invalid merged file name in update baseline")
        current = (AB / name).read_bytes()
        actual = digest(current)
        if actual == expected_hash:
            original = current
        else:
            old = old_files.get(name)
            if not old or actual != old["patched_sha256"]:
                raise RuntimeError("Unknown updated resource; refusing overwrite: " + name)
            original = (BACKUP / name).read_bytes()
            if (digest(original) != expected_hash or expected_hash != old["original_sha256"] or
                    not current.startswith(original)):
                raise RuntimeError("Old patch does not contain the verified update baseline: " + name)
        # The exact supported manifest must not reference leftover appended data.
        if any(e["s"] < 0 or e["s"] >= len(original) for e in entries if e["m"] == name):
            raise RuntimeError("Updated manifest references data outside the clean baseline: " + name)
        originals[name], actuals[name] = original, actual
    evidence = dict(version="0.2.1", game_version=baseline["game_version"],
                    baseline_pending_install=True, resources=[], files=[
                        dict(name=name, original_sha256=digest(data), patched_sha256=actuals[name])
                        for name, data in originals.items()])
    STATE.mkdir(exist_ok=True)
    history = STATE / "history"
    history.mkdir(exist_ok=True)
    # Prepare everything before changing the old restore record. Preserve old
    # backups/build/record together; rollback publication on ordinary failures.
    with tempfile.TemporaryDirectory(prefix="rebase-", dir=STATE) as temp:
        staging = Path(temp)
        staged_backup = staging / "original"
        staged_backup.mkdir()
        for name, data in originals.items():
            (staged_backup / name).write_bytes(data)
        record = json.dumps(evidence, indent=2)
        (staged_backup / "install.json").write_text(record, encoding="utf-8")
        staged_record = staging / "installed.json"
        staged_record.write_text(record, encoding="utf-8")
        # Re-check live inputs before publishing a record that can authorize install.
        for name, expected_hash in actuals.items():
            if digest((AB / name).read_bytes()) != expected_hash:
                raise RuntimeError("Game resources changed during rebase: " + name)
        archive = Path(tempfile.mkdtemp(prefix="before-" + baseline["game_version"] + "-", dir=history))
        archived, published = [], []
        try:
            for source in (BACKUP, BUILD, INSTALLED):
                if source.exists():
                    target = archive / source.name
                    shutil.move(str(source), str(target))
                    archived.append((source, target))
            for source, target in ((staged_backup, BACKUP), (staged_record, INSTALLED)):
                shutil.move(str(source), str(target))
                published.append((source, target))
        except Exception:
            for source, target in reversed(published):
                shutil.move(str(target), str(source))
            for source, target in reversed(archived):
                shutil.move(str(target), str(source))
            raise
    print("Adopted verified game update", baseline["game_version"], "; game files unchanged.")
    print("Previous backups and installation state retained at", archive)
    print("Run build, then install. Restore now uses this game version's baseline.")


def build():
    import UnityPy

    existing = installed_evidence()
    if existing:
        verify_current(existing)
        for entry in existing["files"]:
            assert digest((BACKUP / entry["name"]).read_bytes()) == entry["original_sha256"]
    manifest_bytes = ((BACKUP if existing else AB) / "merge.json").read_bytes()
    entries = json.loads(manifest_bytes)
    supported = json.loads((HERE / "supported-game.json").read_text(encoding="utf-8"))
    targets = [dict(resource=supported["resource"], source="single-space-reset.js",
                    textasset_sha256=supported["textasset_sha256"])] + supported.get("additional_resources", [])
    assert targets[0]["resource"] == RESOURCE
    originals, outputs, resources = {}, {}, []
    expected_entries = [dict(e) for e in entries]
    new_manifest = manifest_bytes
    BUILD.mkdir(parents=True, exist_ok=True)
    for target in targets:
        resource = target["resource"]
        entry = next(e for e in entries if e["r"] == resource)
        name, offset = entry["m"], entry["s"]
        if name not in originals:
            source_path = (BACKUP if existing else AB) / name
            if not source_path.exists():
                source_path = AB / name
            originals[name] = source_path.read_bytes()
            outputs[name] = originals[name]
        merged = originals[name]
        header = merged[offset:offset + 160]
        assert header.startswith(b"UnityFS\0")
        pos = 12
        for _ in range(2):
            pos = header.index(0, pos) + 1
        size = struct.unpack_from(">Q", header, pos)[0]
        bundle = merged[offset:offset + size]
        original_asset = textasset(bundle)
        if digest(original_asset) != target["textasset_sha256"]:
            raise ValueError("Original script differs from the analyzed build: " + resource)
        key = bytes(a ^ b for a, b in zip(original_asset[4:8], b'"use'))
        raw = bytes(x ^ key[(i % 4 + i // 4) % 4] for i, x in enumerate(original_asset[4:]))
        assert raw.startswith(b'"use strict";') and MARKER not in raw
        patched_js = raw + b"\n" + (HERE / target["source"]).read_bytes()
        stem = Path(target["source"]).stem
        js_path = BUILD / (stem + ".patched.js")
        js_path.write_bytes(patched_js)
        subprocess.run(["node", "--check", str(js_path)], check=True)
        encoded = b"NOAH" + bytes(x ^ key[(i % 4 + i // 4) % 4] for i, x in enumerate(patched_js))
        env = UnityPy.load(bundle)
        obj = next(o for o in env.objects if o.type.name == "TextAsset").read()
        obj.m_Script = encoded.decode("utf-8", "surrogateescape")
        obj.save()
        output_bundle = next(iter(env.files.values())).save(packer="original")
        assert textasset(output_bundle) == encoded
        new_offset = len(outputs[name])
        outputs[name] += output_bundle
        pattern = (rb'("r":\s*"' + re.escape(resource.encode()) +
                   rb'",\s*"m":\s*"' + re.escape(name.encode()) +
                   rb'",\s*"s":\s*)' + str(offset).encode() + rb'\b')
        new_manifest, changed = re.subn(pattern, lambda m: m[1] + str(new_offset).encode(), new_manifest)
        assert changed == 1
        next(e for e in expected_entries if e["r"] == resource)["s"] = new_offset
        assert textasset(outputs[name][new_offset:]) == encoded
        resources.append(dict(resource=resource, old_offset=offset, new_offset=new_offset,
                              old_bundle_bytes=len(bundle), new_bundle_bytes=len(output_bundle),
                              patched_js_sha256=digest(patched_js)))
    assert json.loads(new_manifest) == expected_entries
    for name, data in outputs.items():
        assert data[:len(originals[name])] == originals[name]
        (BUILD / name).write_bytes(data)
    (BUILD / "merge.json").write_bytes(new_manifest)
    files = [dict(name=name, original_sha256=digest(originals[name]), patched_sha256=digest(data))
             for name, data in outputs.items()]
    files.append(dict(name="merge.json", original_sha256=digest(manifest_bytes), patched_sha256=digest(new_manifest)))
    evidence = dict(version="0.2.1", resources=resources, files=files,
                    verification="JS syntax + TextAsset binary roundtrip + unchanged original merged bytes + exact target manifest offsets")
    (BUILD / "build.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    return evidence


def game_closed():
    result = subprocess.run(["tasklist", "/FI", "IMAGENAME eq BlazblueEntropyEffect.exe", "/FO", "CSV", "/NH"], capture_output=True)
    if b'"BlazblueEntropyEffect.exe"' in result.stdout:
        raise RuntimeError("Close the game normally before modifying its resources")


def check_writable_files(evidence):
    # Detect access restrictions or file locks before changing the first file.
    # r+b tests write access without truncating or modifying file contents.
    for entry in evidence["files"]:
        with (AB / entry["name"]).open("r+b"):
            pass


def install():
    game_closed()
    evidence = json.loads((BUILD / "build.json").read_text(encoding="utf-8"))
    existing = installed_evidence()
    if existing:
        verify_current(existing)
    if existing:
        old_files = {e["name"]: e for e in existing["files"]}
        if not set(old_files).issubset(e["name"] for e in evidence["files"]):
            raise RuntimeError("Upgrade omits previously patched files; restore first")
    else:
        old_files = {}
    # New releases may add a script in another merged bundle. Validate all
    # sources first, then extend immutable backups before writing game files.
    for entry in evidence["files"]:
        name = entry["name"]
        original_hash = entry["original_sha256"]
        if name in old_files:
            assert original_hash == old_files[name]["original_sha256"]
            assert digest((BACKUP / name).read_bytes()) == original_hash
        else:
            assert digest((AB / name).read_bytes()) == original_hash
            if (BACKUP / name).exists():
                assert digest((BACKUP / name).read_bytes()) == original_hash
        assert digest((BUILD / name).read_bytes()) == entry["patched_sha256"]
    check_writable_files(evidence)
    BACKUP.mkdir(exist_ok=True)
    for entry in evidence["files"]:
        if not (BACKUP / entry["name"]).exists():
            shutil.copy2(AB / entry["name"], BACKUP / entry["name"])
        assert digest((BACKUP / entry["name"]).read_bytes()) == entry["original_sha256"]
    if not existing:
        (BACKUP / "install.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    # Preserve the exact current revision until all writes and hashes succeed.
    # The immutable original backups remain separate from upgrade rollback.
    with tempfile.TemporaryDirectory(prefix="upgrade-", dir=STATE) as temp:
        for entry in evidence["files"]:
            shutil.copy2(AB / entry["name"], Path(temp) / entry["name"])
        try:
            for entry in evidence["files"]:
                shutil.copyfile(BUILD / entry["name"], AB / entry["name"])
                assert digest((AB / entry["name"]).read_bytes()) == entry["patched_sha256"]
            next_state = INSTALLED.with_suffix(".json.tmp")
            next_state.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
            next_state.replace(INSTALLED)
        except Exception:
            for entry in evidence["files"]:
                shutil.copyfile(Path(temp) / entry["name"], AB / entry["name"])
            raise
    print("Installed and verified. Originals backed up at", BACKUP)


def migrate_legacy_state():
    """Move generated state from pre-cleanup installs, never source/game files."""
    migrations = [
        ("single-space-backup-v1", "original"),
        ("single-space-installed.json", "installed.json"),
        ("single-space-build", "build"),
        ("single-space-runtime.log", "runtime.log"),
        ("deps", "deps"),
    ]
    pending = [(HERE / old, STATE / new) for old, new in migrations if (HERE / old).exists()]
    for source, target in pending:
        if not source.resolve().is_relative_to(HERE) or not target.resolve().is_relative_to(STATE.resolve()):
            raise RuntimeError("Migration path is outside the expected source/state directory")
        if target.exists():
            raise RuntimeError("Both legacy and new state exist; refusing to merge: " + str(target))
    if pending:
        STATE.mkdir(exist_ok=True)
        for source, target in pending:
            shutil.move(str(source), str(target))
        print("Moved generated state to", STATE)


def status():
    evidence = installed_evidence()
    if not evidence:
        print("No installed patch backup")
        return
    for entry in evidence["files"]:
        actual = digest((AB / entry["name"]).read_bytes())
        state = ("baseline ready; build/install required" if evidence.get("baseline_pending_install") and
                 actual in {entry["patched_sha256"], entry["original_sha256"]} else
                 "patched" if actual == entry["patched_sha256"] else
                 "original" if actual == entry["original_sha256"] else "modified since install")
        print(entry["name"], state, actual)


def restore():
    game_closed()
    evidence = installed_evidence()
    if not evidence:
        raise RuntimeError("No original backup found")
    verify_current(evidence)
    for entry in evidence["files"]:
        assert digest((AB / entry["name"]).read_bytes()) in {entry["patched_sha256"], entry["original_sha256"]}, "Game updated since patch; refusing overwrite"
        assert digest((BACKUP / entry["name"]).read_bytes()) == entry["original_sha256"]
    check_writable_files(evidence)
    for entry in evidence["files"]:
        shutil.copyfile(BACKUP / entry["name"], AB / entry["name"])
        assert digest((AB / entry["name"]).read_bytes()) == entry["original_sha256"]
    print("Restored all original files; backup retained")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["build", "install", "status", "restore", "rebase"])
    args = parser.parse_args()
    migrate_legacy_state()
    {"build": build, "install": install, "status": status, "restore": restore, "rebase": rebase}[args.action]()
