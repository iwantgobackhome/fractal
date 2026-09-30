# Owned temporary fixture cleanup

The final packaged verification closes its own Electron handle in `finally`, checks that its resolved directory is inside the named `fractal-packaged-stage3-` temporary namespace, removes it, then verifies ENOENT. The JSON manifest records both the owned application close and profile removal.

The first pre-fix seed-Hub failure occurred before that fixture's application/finally block and left one directory. The following exact inline command removed that single directory after resolving its absolute bounds and reading its known single fixture publication; it never enumerated arbitrary paths for deletion or touched the user's app profile. Exit code was 0 and [owned-cleanup.json](owned-cleanup.json) records the proof. A subsequent read-only enumeration of the task-specific temporary namespace returned no directories.

```powershell
@'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { rm,stat,writeFile } from 'node:fs/promises';
const path=resolve(join(tmpdir(),'fractal-packaged-stage3-rCmFJI'));
assert.equal(path,join(resolve(tmpdir()),'fractal-packaged-stage3-rCmFJI'));
assert.ok(path.startsWith(resolve(tmpdir())+sep+'fractal-packaged-stage3-'));
const db=new DatabaseSync(join(path,'library.sqlite'),{readOnly:true});
const rows=db.prepare('SELECT data FROM bibliography').all().map((r) => JSON.parse(r.data));
const title='Cached packaged research with original physical pages and durable publication metadata';
assert.equal(rows.length,1);assert.equal(rows[0].title,title);db.close();
await rm(path,{recursive:true,force:true});
assert.equal(await stat(path).then(() => true,e => {if(e.code==='ENOENT')return false;throw e;}),false);
await writeFile('docs/implementation/desktop/stage3/owned-cleanup.json',JSON.stringify({status:'passed',removedOwnedFailedPreseed:path,fingerprint:title,resolvedTemporaryBoundsValidated:true,onlyKnownSingleFixturePublication:true,userDataReset:false},null,2));
'@ | node --input-type=module
```
