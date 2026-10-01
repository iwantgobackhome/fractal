"""Read actual downloaded installer metadata without running installers."""
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile

directory = pathlib.Path(sys.argv[1]).resolve()
commit, run_id = sys.argv[2:4]
deb = directory / "Fractal-0.2.0-linux-x64.deb"
raw = deb.read_bytes()
assert raw[:8] == b"!<arch>\n"
offset = 8
control_archive = None
members = []
while offset < len(raw):
    header = raw[offset:offset + 60]
    assert len(header) == 60 and header[58:60] == b"`\n"
    name = header[:16].decode("ascii").strip().rstrip("/")
    length = int(header[48:58])
    content = raw[offset + 60:offset + 60 + length]
    assert len(content) == length
    members.append(name)
    if name.startswith("control.tar"):
        control_archive = content
    offset += 60 + length + length % 2
assert control_archive is not None
with tarfile.open(fileobj=io.BytesIO(control_archive), mode="r:*") as archive:
    control = next(member for member in archive.getmembers() if member.name.removeprefix("./") == "control")
    text = archive.extractfile(control).read().decode("utf-8")
fields = {}
for line in text.splitlines():
    if line and not line[0].isspace() and ":" in line:
        key, value = line.split(":", 1)
        fields[key] = value.strip()
assert fields["Version"] == "0.2.0", fields
assert fields["Architecture"] == "amd64", fields
assert fields["Package"] == "fractal", fields

environment = os.environ.copy()
environment["FRACTAL_QA_INSTALLER"] = str(directory / "Fractal-0.2.0-win-x64.exe")
command = "[Diagnostics.FileVersionInfo]::GetVersionInfo($env:FRACTAL_QA_INSTALLER) | Select-Object ProductName,ProductVersion,FileVersion,OriginalFilename | ConvertTo-Json -Compress"
windows = json.loads(subprocess.check_output(["powershell", "-NoProfile", "-NonInteractive", "-Command", command], env=environment, text=True, encoding="utf-8"))
assert windows["ProductVersion"] in ("0.2.0", "0.2.0.0"), windows
assert windows["FileVersion"] in ("0.2.0", "0.2.0.0"), windows
assert windows["ProductName"] == "Fractal", windows
report = {"acceptedSourceCommit": commit, "actualCiRun": run_id,
          "scope": "actual Debian control archive and Windows installer PE version resources; read only, no installation",
          "debian": {"path": str(deb), "arMembers": members, "control": fields},
          "windows": windows, "installedByThisWorker": False}
pathlib.Path("docs/implementation/qa/v020/payload-metadata.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"debian": fields, "windows": windows}, indent=2))
