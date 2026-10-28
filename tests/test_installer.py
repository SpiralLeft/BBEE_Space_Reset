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

    def test_unwritable_manifest_aborts_before_any_resource_write(self):
        installer.install()
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        record = installer.INSTALLED.read_bytes()
        self.write_build(b"release-two")
        actual_open = Path.open

        def open_file(path, mode="r", *args, **kwargs):
            if path == installer.AB / "merge.json" and mode == "r+b":
                raise PermissionError("simulated manifest write restriction")
            return actual_open(path, mode, *args, **kwargs)

        with patch.object(Path, "open", open_file), patch.object(installer.shutil, "copyfile") as copy:
            with self.assertRaisesRegex(PermissionError, "write restriction"):
                installer.install()
            copy.assert_not_called()
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})
        self.assertEqual(installer.INSTALLED.read_bytes(), record)

    def test_upgrade_adds_resource_backup_and_restore_covers_it(self):
        installer.install()
        first_backup = (installer.BACKUP / "install.json").read_bytes()
        self.originals["settings.m"] = b"original settings bundle"
        (installer.AB / "settings.m").write_bytes(self.originals["settings.m"])
        self.write_build(b"release-with-settings")
        installer.install()
        self.assertEqual((installer.BACKUP / "settings.m").read_bytes(), self.originals["settings.m"])
        self.assertEqual((installer.BACKUP / "install.json").read_bytes(), first_backup)
        installer.restore()
        for name, original in self.originals.items():
            self.assertEqual((installer.AB / name).read_bytes(), original)

    def test_new_resource_write_failure_rolls_back_upgrade_and_record(self):
        installer.install()
        self.originals["settings.m"] = b"original settings bundle"
        (installer.AB / "settings.m").write_bytes(self.originals["settings.m"])
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        old_record = installer.INSTALLED.read_bytes()
        self.write_build(b"release-with-settings")
        actual_copy = installer.shutil.copyfile

        def copy(source, target, *args, **kwargs):
            if Path(source) == installer.BUILD / "settings.m" and Path(target) == installer.AB / "settings.m":
                raise OSError("simulated added resource write failure")
            return actual_copy(source, target, *args, **kwargs)

        with patch.object(installer.shutil, "copyfile", side_effect=copy):
            with self.assertRaisesRegex(OSError, "added resource"):
                installer.install()
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)
        # The retained new original backup supports retrying the same upgrade.
        installer.install()
        installer.restore()
        self.assertEqual((installer.AB / "settings.m").read_bytes(), self.originals["settings.m"])

    def test_upgrade_rejects_modified_added_resource_before_writes(self):
        installer.install()
        self.originals["settings.m"] = b"original settings bundle"
        (installer.AB / "settings.m").write_bytes(b"changed by another mod")
        self.write_build(b"release-with-settings")
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        with self.assertRaises(AssertionError):
            installer.install()
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})

    def prepare_game_update(self, clean=False):
        installer.install()
        old_record = installer.INSTALLED.read_bytes()
        old_backup = {p.name: p.read_bytes() for p in installer.BACKUP.iterdir()}
        manifest = json.dumps([
            {"r": installer.RESOURCE, "m": "bundle.m", "s": 0},
            {"r": "synthetic/new-game-resource.ab", "m": "other.m", "s": 123},
        ]).encode()
        (installer.AB / "merge.json").write_bytes(manifest)
        if clean:
            (installer.AB / "bundle.m").write_bytes(self.originals["bundle.m"])
        support = {"resource": installer.RESOURCE, "update_baselines": [{
            "game_version": "synthetic-next-version",
            "manifest_sha256": installer.digest(manifest),
            "files": {"bundle.m": installer.digest(self.originals["bundle.m"])},
        }]}
        (installer.HERE / "supported-game.json").write_text(json.dumps(support), encoding="utf-8")
        return manifest, old_record, old_backup

    def test_rebase_preserves_updated_manifest_and_archives_previous_state(self):
        manifest, old_record, old_backup = self.prepare_game_update()
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        installer.rebase()
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})
        self.assertEqual((installer.BACKUP / "merge.json").read_bytes(), manifest)
        self.assertEqual((installer.BACKUP / "bundle.m").read_bytes(), self.originals["bundle.m"])
        self.assertFalse(installer.BUILD.exists(), "old build must not survive adoption of a new baseline")
        with self.assertRaises(FileNotFoundError):
            installer.install()
        history = list((installer.STATE / "history").iterdir())
        self.assertEqual(len(history), 1)
        self.assertEqual((history[0] / "installed.json").read_bytes(), old_record)
        self.assertTrue((history[0] / "build/build.json").exists())
        for name, data in old_backup.items():
            self.assertEqual((history[0] / "original" / name).read_bytes(), data)
        installer.verify_current(installer.installed_evidence())
        installer.rebase()  # Idempotent: do not create another archive.
        self.assertEqual(len(list((installer.STATE / "history").iterdir())), 1)
        self.originals["merge.json"] = manifest
        installer.BUILD.mkdir()
        self.write_build(b"new-version-mod")
        installer.install()
        installer.restore()
        self.assertEqual((installer.AB / "merge.json").read_bytes(), manifest)
        self.assertEqual((installer.AB / "bundle.m").read_bytes(), self.originals["bundle.m"])

    def test_rebase_accepts_clean_updated_resources(self):
        manifest, _, _ = self.prepare_game_update(clean=True)
        installer.rebase()
        installer.restore()
        self.assertEqual((installer.AB / "merge.json").read_bytes(), manifest)

    def test_rebase_rejects_unknown_manifest_without_touching_state(self):
        _, old_record, old_backup = self.prepare_game_update()
        (installer.AB / "merge.json").write_bytes(b"unknown updated manifest")
        with self.assertRaisesRegex(RuntimeError, "Unknown game manifest"):
            installer.rebase()
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)
        for name, data in old_backup.items():
            self.assertEqual((installer.BACKUP / name).read_bytes(), data)
        self.assertFalse((installer.STATE / "history").exists())

    def test_rebase_rejects_unknown_bundle_without_touching_state(self):
        _, old_record, _ = self.prepare_game_update()
        (installer.AB / "bundle.m").write_bytes(b"other mod or unrecognized game content")
        with self.assertRaisesRegex(RuntimeError, "Unknown updated resource"):
            installer.rebase()
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)
        self.assertTrue(installer.BUILD.exists())

    def test_rebase_rejects_corrupt_original_backup(self):
        _, old_record, _ = self.prepare_game_update()
        (installer.BACKUP / "bundle.m").write_bytes(b"damaged backup")
        with self.assertRaisesRegex(RuntimeError, "verified update baseline"):
            installer.rebase()
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)

    def test_rebase_does_not_adopt_leftover_appended_data_as_original(self):
        _, old_record, _ = self.prepare_game_update()
        manifest = json.dumps([{"r": installer.RESOURCE, "m": "bundle.m",
                                "s": len(self.originals["bundle.m"])}]).encode()
        (installer.AB / "merge.json").write_bytes(manifest)
        support_path = installer.HERE / "supported-game.json"
        support = json.loads(support_path.read_text())
        support["update_baselines"][0]["manifest_sha256"] = installer.digest(manifest)
        support_path.write_text(json.dumps(support))
        with self.assertRaisesRegex(RuntimeError, "outside the clean baseline"):
            installer.rebase()
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)

    def test_failed_rebase_publication_restores_previous_state_and_build(self):
        _, old_record, old_backup = self.prepare_game_update()
        before = {p.name: p.read_bytes() for p in installer.AB.iterdir()}
        actual_move = installer.shutil.move

        def move(source, target, *args, **kwargs):
            if Path(target) == installer.INSTALLED and Path(source).parent.name.startswith("rebase-"):
                raise OSError("simulated record publication failure")
            return actual_move(source, target, *args, **kwargs)

        with patch.object(installer.shutil, "move", side_effect=move):
            with self.assertRaisesRegex(OSError, "record publication"):
                installer.rebase()
        self.assertEqual(installer.INSTALLED.read_bytes(), old_record)
        self.assertTrue((installer.BUILD / "build.json").exists())
        for name, data in old_backup.items():
            self.assertEqual((installer.BACKUP / name).read_bytes(), data)
        self.assertEqual(before, {p.name: p.read_bytes() for p in installer.AB.iterdir()})

    def test_resources_modified_after_rebase_cannot_be_overwritten(self):
        manifest, _, _ = self.prepare_game_update()
        installer.rebase()
        self.originals["merge.json"] = manifest
        installer.BUILD.mkdir()
        self.write_build(b"new-version-mod")
        (installer.AB / "merge.json").write_bytes(b"another update after rebase")
        with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
            installer.install()
        with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
            installer.restore()

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
