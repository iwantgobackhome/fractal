# Android publication acquisition checkpoint

Based on accepted `d1311d3789076b71080424e154a4d1d5d8590b6c`; changes are confined to `apps/android/`.

The dossier offers primary Read PDF for publications with or without a reported PDF URL, without prerequisite Save. It uses POST `/api/publications/open`, imports the canonical record through SyncEngine pending-edit projection, refreshes the normal authoritative paper snapshot, verifies cached bytes through PdfDownloader/PdfCache, and only then routes to the existing original reader. The reader alone records Recent. Existing linked PDFs retain the normal path; publication and reported PDF URLs remain explicit external actions, and manual Link PDF remains optional.

Captured HTTP sessions validate the full pairing credentials, while acquisition also checks discovery scope and the mounted/current publication request before Room projection, snapshot/PDF changes, transfer/cache, and reader navigation. Guarded Room transactions roll back if the guard changes. Canonical projection preserves pending Save/Unsave, tags, folders, and read history, without deleting offline intent or annotations.

Initial debug app/test APK builds and app/sync/data unit tests pass. `PublicationAcquisitionTest` passes four native Room tests on the owned `emulator-5562`: canonical unsaved admission, late scope and superseded request rejection, concurrent unsave/tags/nested membership/history/memo retention, and old-Hub/no-PDF fallback without fake Recent/Save.

Final real HTTP/MainActivity acceptance and final APK identity are pending coordinator-supplied accepted backend source at a committed clean boundary. No final APK is claimed at this checkpoint. No physical S Pen verification is claimed.

Resource preflight found no adb serials, emulator processes, or listeners on 5562/5563. The owned hidden read-only headless Pixel_2_API_34 instance was launched with `-port 5562 -read-only -no-window -no-audio -no-snapshot -gpu swiftshader_indirect`; launcher PID 45404, child QEMU PID 39892. Exact executable/start/command/listener receipts are retained in ignored `apps/android/qa/pdf-acquisition/data/`, and only this resource may be stopped during cleanup.
