from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
BP = ROOT / "packs" / "behavior_pack"
RP = ROOT / "packs" / "resource_pack"


def pack_directory(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source).as_posix())


def main() -> None:
    DIST.mkdir(exist_ok=True)
    bp_version = json.loads((BP / "manifest.json").read_text(encoding="utf-8"))["header"]["version"]
    version = ".".join(map(str, bp_version))
    bp_file = DIST / f"Shift_and_Fade_BP_v{version}.mcpack"
    rp_file = DIST / f"Shift_and_Fade_RP_v{version}.mcpack"
    addon_file = DIST / f"Shift_and_Fade_v{version}.mcaddon"

    pack_directory(BP, bp_file)
    pack_directory(RP, rp_file)
    with zipfile.ZipFile(addon_file, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.write(bp_file, bp_file.name)
        archive.write(rp_file, rp_file.name)

    print(addon_file)


if __name__ == "__main__":
    main()
