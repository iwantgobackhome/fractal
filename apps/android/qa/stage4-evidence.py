"""Read-only artifact inventory; never edits images or opens private QA runtime files."""
import argparse
import hashlib
import json
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
args = parser.parse_args()
qa = Path(__file__).resolve().parent
android = qa.parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


app_apk = android / "app/build/outputs/apk/debug/app-debug.apk"
test_apk = android / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
apks = [{"path": str(path), "sha256": digest(path), "bytes": path.stat().st_size}
        for path in (app_apk, test_apk)]
delivery_paths = [qa / "stage4-apks/app-e690dca-debug.apk", qa / "stage4-apks/app-e690dca-debug-androidTest.apk"]
for row, path in zip(apks, delivery_paths):
    assert digest(path) == row["sha256"]
    row["immutableDeliveryPath"] = str(path)
with zipfile.ZipFile(app_apk) as apk:
    entries = apk.namelist()
    resources = {
        "apk": str(app_apk), "sha256": digest(app_apk),
        "launcherEntries": [name for name in entries if "ic_launcher" in name or "branch_mark" in name],
        "bundledFonts": [name for name in entries if name.startswith("res/font/")],
        "qaArticleHardcodedInAppDex": any(
            b"This isolated QA article" in apk.read(name) or b"QA research field report:" in apk.read(name)
            for name in entries if name.endswith(".dex")),
    }
assert not resources["qaArticleHardcodedInAppDex"]
(qa / "stage4-apk-resources.json").write_text(json.dumps(resources, indent=2) + "\n", encoding="utf-8")

units = []
for module in ("app", "data", "sync", "ink"):
    for path in sorted((android / module / "build/test-results/testDebugUnitTest").glob("TEST-*.xml")):
        root = ET.parse(path).getroot()
        units.append({"module": module, "suite": root.attrib["name"],
                      **{key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")}})
assert all(item["failures"] == item["errors"] == 0 for item in units)

earlier_apk = "064567774c180cd784a8886ecfabafb2e14f8ecd2e4c08105aa1364a7cfda0ba"
profiles = {
    "phone360-portrait": (360, 800, 1, "en", "Light"),
    "phone360-landscape": (800, 360, 1, "en", "Light"),
    "tablet800-portrait": (800, 1280, 1, "en", "Light"),
    "tablet800-landscape": (1280, 800, 1, "en", "Light"),
    "tablet1280-portrait": (1280, 1800, 1, "en", "Light"),
    "tablet1280-landscape": (1800, 1280, 1, "en", "Light"),
    "phone360-font2-ko": (360, 800, 2, "ko", "Sepia"),
    "tablet1280-font2-dark": (1800, 1280, 2, "en", "Dark"),
}
shots = []
for directory in sorted((qa / "stage4-screens").iterdir()):
    if not directory.is_dir():
        continue
    files = sorted(directory.glob("*.png"))
    latest = {}
    for path in files:
        scene = re.sub(r"-\d+x\d+-font[\d.]+\.png$", "", path.name)
        if scene not in latest or path.stat().st_mtime > latest[scene].stat().st_mtime:
            latest[scene] = path
    for path in files:
        scene = re.sub(r"-\d+x\d+-font[\d.]+\.png$", "", path.name)
        width, height = struct.unpack(">II", path.read_bytes()[16:24])
        current = directory.name in ("tablet1280-font2-dark", "disposition") or "-final-" in path.name
        latest_variant = latest[scene] == path
        observed_apk = digest(app_apk) if current else earlier_apk if directory.name in profiles and latest_variant else None
        shots.append({"path": path.relative_to(qa).as_posix(), "profile": directory.name,
                      "scene": scene, "pixels": [width, height], "sha256": digest(path),
                      "latestCopiedSceneVariant": latest_variant, "observedAppApkSha256": observed_apk,
                      "scope": "current final source" if current else "pre-news-source-label capture; other product layout unchanged" if observed_apk else "earlier stage4 native/review proof; exact APK hash not retained"})

manifest = {
    "productSourceSha": args.source,
    "scope": "Android debug application + debug instrumentation APK; min29/target35/compile35; actual emulator API34 only",
    "apks": apks,
    "debugSigning": {"certificateDN": "C=US, O=Android, CN=Android Debug",
                     "certificateSha256": "62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f"},
    "unitSuites": units, "unitTotals": {key: sum(row[key] for row in units) for key in ("tests", "failures", "errors", "skipped")},
    "captureProfiles": {name: {"requestedWmPixelsAtDensity160": list(values[:2]), "fontScale": values[2], "language": values[3], "theme": values[4]}
                        for name, values in profiles.items()},
    "screenshots": shots,
    "captureScope": "Eight actual native profiles passed. Standard six and initial KO profile precede only the final concise article source/date label. Final dark tablet and targeted KO article/source/body use the final app APK. No unchanged matrix repeated solely for that narrow label fix. Raw system/status/navigation bars are retained.",
    "limitations": ["No physical Galaxy Tab/S Pen", "No API29/API35 runtime run", "Outbound provider graphs/news/translation are controlled QA boundaries; actual Hub API/storage and Android rendering", "Process-cold offline JUnit proof retained; its separate capture directory was not copied before scoped emulator closure"],
}
(qa / "stage4-artifact-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps({"source": args.source, "apks": apks, "unitTotals": manifest["unitTotals"], "screenshots": len(shots)}, indent=2))
