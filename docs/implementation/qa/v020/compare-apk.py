"""Compare actual CI and captured-runtime APK contents without installing either."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import zipfile

runtime_only = sys.argv[1] == '--runtime-only'
if runtime_only:
    runtime_apk, accepted_commit = map(str, sys.argv[2:4])
    ci_apk = None
else:
    ci_apk, runtime_apk, accepted_commit = map(str, sys.argv[1:4])
assert re.fullmatch(r"[a-f0-9]{40}", accepted_commit)
tools = pathlib.Path(r"C:/Users/Home/AppData/Local/Android/Sdk/build-tools/35.0.0")
expected_cert = "62e0698d0572e672aa65a999c6e6e4a6669fb2baf4ca0c6f9c2ce7f82bdd7f4f"


def inspect(path):
    artifact = pathlib.Path(path).resolve()
    badging = subprocess.check_output([str(tools / "aapt.exe"), "dump", "badging", str(artifact)], text=True, encoding="utf-8")
    assert "package: name='app.fractal.reader' versionCode='2' versionName='0.2.0'" in badging
    signer = subprocess.check_output([str(tools / "apksigner.bat"), "verify", "--verbose", "--print-certs", str(artifact)], text=True, encoding="utf-8")
    certificate = re.search(r"Signer #1 certificate SHA-256 digest: ([a-f0-9]+)", signer).group(1)
    assert certificate == expected_cert
    with zipfile.ZipFile(artifact) as archive:
        entries = {name: {"sha256": hashlib.sha256(archive.read(name)).hexdigest(), "bytes": archive.getinfo(name).file_size}
                   for name in sorted(archive.namelist()) if not name.endswith("/") and not name.startswith("META-INF/")}
    assert "resources.arsc" in entries
    assert any(name.startswith("classes") and name.endswith(".dex") for name in entries)
    return {"path": str(artifact), "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(), "bytes": artifact.stat().st_size,
            "certificateSha256": certificate, "badging": badging, "signatureVerification": signer, "entries": entries}


runtime = inspect(runtime_apk)
if runtime_only:
    report = {"acceptedRuntimeSourceCommit": accepted_commit, "scope": "retained actual native runtime APK; public manifest/signature and entry hashes; no CI artifact comparison yet",
              "installedByThisWorker": False, "capturedRuntime": runtime}
    pathlib.Path("docs/implementation/qa/v020/runtime-apk-evidence.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"sha256": runtime["sha256"], "entries": len(runtime["entries"]), "certificateSha256": runtime["certificateSha256"]}, indent=2))
    sys.exit(0)
ci = inspect(ci_apk)
differences = [name for name in sorted(set(ci["entries"]) | set(runtime["entries"])) if ci["entries"].get(name) != runtime["entries"].get(name)]
report = {"acceptedSourceCommit": accepted_commit, "scope": "actual downloaded CI APK versus locally tested native runtime APK; public signature/manifest and ZIP entry correspondence only",
          "installedByThisWorker": False, "ci": ci, "capturedRuntime": runtime,
          "comparedEntries": len(ci["entries"]), "excludes": "META-INF signing/build metadata; ZIP timestamps and APK signing blocks do not affect entry byte comparison",
          "differences": differences, "exactApplicationEntryMatch": not differences}
pathlib.Path("docs/implementation/qa/v020/apk-correspondence.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps({"comparedEntries": report["comparedEntries"], "exactApplicationEntryMatch": not differences, "differences": differences}, indent=2))
assert not differences, "APK content differences require explicit source/resource review; do not claim binary runtime correspondence"
