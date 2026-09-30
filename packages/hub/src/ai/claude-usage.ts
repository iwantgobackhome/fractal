import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AiAccountLimits } from '@fractal/shared';

const run = promisify(execFile);
/** Optional Windows PTY probe. It drives the official /usage screen and emits only the two windows. */
const probe = String.raw`
import os, sys, time, re, json, queue, threading, shutil, datetime
from zoneinfo import ZoneInfo
from winpty import PtyProcess
q = queue.Queue()
p = PtyProcess.spawn(shutil.which('claude.exe') or 'claude.exe', cwd=os.getcwd(), env=os.environ.copy(), dimensions=(40, 120))
def reader():
    while p.isalive():
        try: q.put(p.read(4096))
        except Exception: break
threading.Thread(target=reader, daemon=True).start()
output = ''
ansi = re.compile(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))')
def collect():
    global output
    while not q.empty(): output += q.get_nowait()
    output = output[-40000:]
    return ansi.sub('', output)
try:
    ready = time.monotonic() + 18
    while time.monotonic() < ready:
        screen = collect()
        if 'ClaudeCode' in screen or 'Claude Code' in screen or '/effort' in screen: break
        time.sleep(.2)
    p.write('/usage\r')
    deadline = time.monotonic() + 18
    values = {}
    while time.monotonic() < deadline:
        screen = collect()
        for key, pattern in [('fiveHour', r'Current\s*session'), ('weekly', r'Current\s*week\s*\(all\s*models\)')]:
            match = re.search(pattern + r'.{0,130}?(\d{1,3})\s*%\s*used\s*Resets\s*([^\r\n]{0,55})', screen, re.I | re.S)
            if match:
                reset = match.group(2).split('Current')[0].split("What's")[0]
                values[key] = {'usedPercent': int(match.group(1)), 'resetText': reset}
        if len(values) == 2: break
        time.sleep(.2)
    def iso(raw):
        timezone = re.search(r'\(([^)]+/[^)]+)\)', raw)
        try: zone = ZoneInfo(timezone.group(1)) if timezone else datetime.datetime.now().astimezone().tzinfo
        except Exception: zone = datetime.datetime.now().astimezone().tzinfo
        now = datetime.datetime.now(zone)
        text = raw.replace(' ', '')
        m = re.search(r'(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2}),?)?(\d{1,2})(?::(\d{2}))?(am|pm)', text, re.I)
        if not m: return None
        month = list(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']).index(m.group(1).title()) + 1 if m.group(1) else now.month
        day = int(m.group(2)) if m.group(2) else now.day
        hour = int(m.group(3)) % 12 + (12 if m.group(5).lower() == 'pm' else 0)
        minute = int(m.group(4) or 0)
        try: target = datetime.datetime(now.year, month, day, hour, minute, tzinfo=zone)
        except ValueError: return None
        if target < now: target = target.replace(year=now.year+1) if m.group(1) else target + datetime.timedelta(days=1)
        return target.astimezone(datetime.timezone.utc).isoformat().replace('+00:00','Z')
    result = {key: {'usedPercent': value['usedPercent'], 'resetsAt': iso(value['resetText'])} for key, value in values.items()}
    print(json.dumps(result), flush=True)
finally:
    try: p.terminate()
    except Exception: pass
`;

export async function readClaudeUsageViaPty(env: NodeJS.ProcessEnv): Promise<AiAccountLimits['windows']> {
  if (process.platform !== 'win32') return { fiveHour: null, weekly: null };
  const result = await run('python', ['-u', '-c', probe], { env, windowsHide: true, timeout: 45000, maxBuffer: 100000 });
  const parsed = JSON.parse(result.stdout.trim()) as Partial<AiAccountLimits['windows']>;
  return { fiveHour: parsed.fiveHour ?? null, weekly: parsed.weekly ?? null };
}
