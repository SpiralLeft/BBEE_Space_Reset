"""Installer tests using synthetic bytes; no game code or assets are included."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("installer", Path(__file__).resolve().parents[1] / "patch_single_space.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="space-reset-test-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        state = root / ".single-space-local"
        paths = {
            "ROOT": root, "HERE": root / ".interface-analysis", "STATE": state,
            "AB": root / "game-assets", "BUILD": state / "build",
            "BACKUP": state / "original", "INSTALLED": state / "installed.json",
        }
        for name, value in paths.items():
            active = patch.object(installer, name, value)
            active.start()
            self.addCleanup(active.stop)
        installer.HERE.mkdir()
        installer.AB.mkdir()
        installer.BUILD.mkdir(parents=True)
        self.originals = {"bundle.m": b"synthetic original bundle", "merge.json": b"synthetic original manifest"}
        for name, data in self.originals.items():
            (installer.AB / name).write_bytes(data)
        self.write_build(b"release-one")
        active = patch.object(installer, "game_closed")
        active.start()
        self.addCleanup(active.stop)

    def write_build(self, suffix):
        self.evidence = {"version": "0.1.3", "files": []}
        for name, original in self.originals.items():
            data = original + suffix
            (installer.BUILD / name).write_bytes(data)
            self.evidence["files"].append({
                "name": name, "original_sha256": installer.digest(original),
                "patched_sha256": installer.digest(data),
            })
        (installer.BUILD / "build.json").write_text(json.dumps(self.evidence), encoding="utf-8")

    def test_install_upgrade_restore_preserves_originals(self):
        installer.install()
        first_backup = (installer.BACKUP / "install.json").read_bytes()
        for name, data in self.originals.items():
            self.assertEqual((installer.BACKUP / name).read_bytes(), data)
        self.write_build(b"release-two")
        installer.install()
        self.assertEqual((installer.BACKUP / "install.json").read_bytes(), first_backup)
        installer.verify_current(installer.installed_evidence())
        installer.restore()
        for name, data in self.originals.items():
            self.assertEqual((installer.AB / name).read_bytes(), data)
        self.assertEqual(list(installer.HERE.iterdir()), [], "generated files must stay outside source")

    def test_modified_game_file_is_not_overwritten(self):
        installer.install()
        changed = installer.AB / "bundle.m"
        changed.write_bytes(b"changed by game update or another mod")
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
            installer.install()
        with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
            installer.restore()
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})

    def test_failed_upgrade_rolls_back_both_files(self):
        installer.install()
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        old_record = installer.INSTALLED.read_bytes()
        self.write_build(b"release-two")
        actual_copy = installer.shutil.copyfile

        def copy(source, target, *args, **kwargs):
            if Path(source) == installer.BUILD / "merge.json" and Path(target) == installer.AB / "merge.json":
                raise OSError("simulated second write failure")
            return actual_copy(source, target, *args, **kwargs)

        with patch.object(installer.shutil, "copyfile", side_effect=copy):
            with self.assertRaisesRegex(OSError, "second write failure"):
                installer.install()
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)

    def test_legacy_migration_preserves_backups(self):
        legacy = installer.HERE / "single-space-backup-v1"
        legacy.mkdir()
        (legacy / "bundle.m").write_bytes(b"original backup")
        record = installer.HERE / "single-space-installed.json"
        record.write_bytes(b"installation record")
        installer.migrate_legacy_state()
        self.assertEqual((installer.BACKUP / "bundle.m").read_bytes(), b"original backup")
        self.assertEqual(installer.INSTALLED.read_bytes(), b"installation record")
        self.assertEqual(list(installer.HERE.iterdir()), [])
        installer.migrate_legacy_state()

    def test_migration_conflict_does_not_move_any_files(self):
        (installer.HERE / "single-space-installed.json").write_bytes(b"legacy")
        installer.INSTALLED.write_bytes(b"new")
        with self.assertRaisesRegex(RuntimeError, "refusing to merge"):
            installer.migrate_legacy_state()
        self.assertEqual(installer.INSTALLED.read_bytes(), b"new")
        self.assertEqual((installer.HERE / "single-space-installed.json").read_bytes(), b"legacy")


if __name__ == "__main__":
    unittest.main()
