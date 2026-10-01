# Android publication acquisition checkpoint

Based on accepted `d1311d3789076b71080424e154a4d1d5d8590b6c`; changes are confined to `apps/android/`.

The dossier offers primary Read PDF for publications with or without a reported PDF URL, without prerequisite Save. It uses POST `/api/publications/open`, imports the canonical record through SyncEngine pending-edit projection, refreshes the normal authoritative paper snapshot, verifies cached bytes through PdfDownloader/PdfCache, and only then routes to the existing original reader. The reader alone records Recent. Existing linked PDFs retain the normal path; publication and reported PDF URLs remain explicit external actions, and manual Link PDF remains optional.

Captured HTTP sessions validate the full pairing credentials, while acquisition also checks discovery scope and the mounted/current publication request before Room projection, snapshot/PDF changes, transfer/cache, and reader navigation. Guarded Room transactions roll back if the guard changes. Canonical projection preserves pending Save/Unsave, tags, folders, and read history, without deleting offline intent or annotations.

Initial debug app/test APK builds and app/sync/data unit tests pass. `PublicationAcquisitionTest` passes four native Room tests on the owned `emulator-5562`: canonical unsaved admission, late scope and superseded request rejection, concurrent unsave/tags/nested membership/history/memo retention, and old-Hub/no-PDF fallback without fake Recent/Save.

Coordinator review corrections validate hasPdf, returned Paper/key/hash/page count, and matching authoritative snapshot before atomic Room admission. Structured publisher/PDF error reasons remain intact; only bare 404/405 responses get the compatibility explanation. The acquisition-specific captured transport allows a 90-second read timeout and 100-second call deadline for the backend's 60-second network budget plus processing, with transport retries disabled and unrelated request timeouts preserved.

The reviewed debug app/test APK builds and app/sync unit tests pass. Five native Room acquisition tests pass, including additional structured 404 versus bare old-Hub and malformed/no-PDF/mismatched-key/changed-hash checks with no local admission.

The focused real HTTP harness and MainActivity tests are prepared but have not run against the new endpoint. The harness requires the coordinator's accepted clean source SHA and builds its Hub from that exact source; it owns distinct 6284/6285 proxy/control listeners and ignored private storage. Public JMLR acquisition is separate from controlled old-Hub/login-HTML/response-delay cases. Final real HTTP/MainActivity acceptance and final APK identity are pending coordinator-supplied accepted backend source at a committed clean boundary. No final APK is claimed at this checkpoint. No physical S Pen verification is claimed.

Resource preflight found no adb serials, emulator processes, or listeners on 5562/5563. The owned hidden read-only headless Pixel_2_API_34 instance was launched with `-port 5562 -read-only -no-window -no-audio -no-snapshot -gpu swiftshader_indirect`; launcher PID 45404, child QEMU PID 39892. Exact executable/start/command/listener receipts are retained in ignored `apps/android/qa/pdf-acquisition/data/`, and only this resource may be stopped during cleanup.
