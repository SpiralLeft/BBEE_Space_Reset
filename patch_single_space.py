"""Build/install/restore one reversible TextAsset patch in the merged Unity bundles.

Original bundles are never repacked in bulk. Installation appends one rebuilt
bundle to the existing merged file and changes only its start offset in merge.json.
Full backups and hashes are kept before the first write; restore checks the
installed hashes before replacing either file.
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
MARKER = b"menu patch v0.1.6 loaded"


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
            raise RuntimeError("Game updated or resources changed; refusing overwrite: " + entry["name"])


def build():
    import UnityPy

    existing = installed_evidence()
    source = BACKUP if existing else AB
    if existing:
        verify_current(existing)
        for entry in existing["files"]:
            assert digest((BACKUP / entry["name"]).read_bytes()) == entry["original_sha256"]
    manifest_bytes = (source / "merge.json").read_bytes()
    entries = json.loads(manifest_bytes)
    entry = next(e for e in entries if e["r"] == RESOURCE)
    merged = (source / entry["m"]).read_bytes()
    offset = entry["s"]
    header = merged[offset:offset + 160]
    assert header.startswith(b"UnityFS\0")
    pos = 12
    for _ in range(2):
        pos = header.index(0, pos) + 1
    size = struct.unpack_from(">Q", header, pos)[0]
    bundle = merged[offset:offset + size]
    original_asset = textasset(bundle)
    supported = json.loads((HERE / "supported-game.json").read_text(encoding="utf-8"))
    if supported["resource"] != RESOURCE or digest(original_asset) != supported["textasset_sha256"]:
        raise ValueError("Original PDA script differs from the analyzed build")
    key = bytes(a ^ b for a, b in zip(original_asset[4:8], b'"use'))
    raw = bytes(x ^ key[(i % 4 + i // 4) % 4] for i, x in enumerate(original_asset[4:]))
    assert raw.startswith(b'"use strict";') and MARKER not in raw
    addition = (HERE / "single-space-reset.js").read_bytes()
    patched_js = raw + b"\n" + addition
    BUILD.mkdir(parents=True, exist_ok=True)
    js_path = BUILD / "pdassistant.patched.js"
    js_path.write_bytes(patched_js)
    subprocess.run(["node", "--check", str(js_path)], check=True)
    encoded = b"NOAH" + bytes(x ^ key[(i % 4 + i // 4) % 4] for i, x in enumerate(patched_js))
    env = UnityPy.load(bundle)
    obj = next(o for o in env.objects if o.type.name == "TextAsset").read()
    obj.m_Script = encoded.decode("utf-8", "surrogateescape")
    obj.save()
    output_bundle = next(iter(env.files.values())).save(packer="original")
    assert textasset(output_bundle) == encoded
    # Preserve every byte of the original merged file, including other bundles.
    new_merged = merged + output_bundle
    pattern = (rb'("r":\s*"' + re.escape(RESOURCE.encode()) +
               rb'",\s*"m":\s*"' + re.escape(entry["m"].encode()) +
               rb'",\s*"s":\s*)' + str(offset).encode() + rb'\b')
    new_manifest, changed = re.subn(pattern, lambda m: m[1] + str(len(merged)).encode(), manifest_bytes)
    assert changed == 1
    new_entries = json.loads(new_manifest)
    expected_entries = [dict(e, s=len(merged)) if e["r"] == RESOURCE else e for e in entries]
    assert new_entries == expected_entries
    assert new_merged[:len(merged)] == merged
    assert textasset(new_merged[len(merged):]) == encoded
    (BUILD / entry["m"]).write_bytes(new_merged)
    (BUILD / "merge.json").write_bytes(new_manifest)
    evidence = {
        "version": "0.1.6", "resource": RESOURCE, "old_offset": offset, "new_offset": len(merged),
        "old_bundle_bytes": len(bundle), "new_bundle_bytes": len(output_bundle),
        "patched_js_sha256": digest(patched_js), "files": [
            {"name": entry["m"], "original_sha256": digest(merged), "patched_sha256": digest(new_merged)},
            {"name": "merge.json", "original_sha256": digest(manifest_bytes), "patched_sha256": digest(new_manifest)},
        ],
        "verification": "JS syntax + TextAsset binary roundtrip + unchanged original merged bytes + one manifest offset",
    }
    (BUILD / "build.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    return evidence


def game_closed():
    result = subprocess.run(["tasklist", "/FI", "IMAGENAME eq BlazblueEntropyEffect.exe", "/FO", "CSV", "/NH"], capture_output=True)
    if b'"BlazblueEntropyEffect.exe"' in result.stdout:
        raise RuntimeError("Close the game normally before modifying its resources")


def install():
    game_closed()
    evidence = json.loads((BUILD / "build.json").read_text(encoding="utf-8"))
    existing = installed_evidence()
    if existing:
        verify_current(existing)
    for entry in evidence["files"]:
        if not existing:
            assert digest((AB / entry["name"]).read_bytes()) == entry["original_sha256"]
        else:
            assert digest((BACKUP / entry["name"]).read_bytes()) == entry["original_sha256"]
        assert digest((BUILD / entry["name"]).read_bytes()) == entry["patched_sha256"]
    if not existing:
        BACKUP.mkdir()
        for entry in evidence["files"]:
            shutil.copy2(AB / entry["name"], BACKUP / entry["name"])
            assert digest((BACKUP / entry["name"]).read_bytes()) == entry["original_sha256"]
        (BACKUP / "install.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    # Preserve the exact current revision until both writes and hashes succeed.
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
        state = "patched" if actual == entry["patched_sha256"] else "original" if actual == entry["original_sha256"] else "modified since install"
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
    for entry in evidence["files"]:
        shutil.copyfile(BACKUP / entry["name"], AB / entry["name"])
        assert digest((AB / entry["name"]).read_bytes()) == entry["original_sha256"]
    print("Restored both original files; backup retained")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["build", "install", "status", "restore"])
    args = parser.parse_args()
    migrate_legacy_state()
    {"build": build, "install": install, "status": status, "restore": restore}[args.action]()
