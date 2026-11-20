import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Open in DaVinci, one click (beta, Resolve Studio only): a Python script
 * run with Resolve's own interpreter talks to the open Resolve through its
 * scripting API. It makes a new project at the timeline's frame rate and
 * size, imports the exported FCPXML, brings the subtitles in, and opens the
 * Edit page. The free version takes no outside scripts, so there it answers
 * "not reachable".
 */

/** The script. Its arguments come as JSON on stdin; it prints one JSON line. */
export const OPEN_SCRIPT = String.raw`
import json, os, sys, time

args = json.loads(sys.stdin.read())

def out(ok, **kw):
    kw['ok'] = ok
    print(json.dumps(kw))
    sys.stdout.flush()
    sys.exit(0)

if args.get('api'):
    os.environ['RESOLVE_SCRIPT_API'] = args['api']
    os.environ['RESOLVE_SCRIPT_LIB'] = args['lib']
    sys.path.append(os.path.join(args['api'], 'Modules'))
try:
    import DaVinciResolveScript as dvr
except Exception as e:
    out(False, code='no_module', detail=str(e))

resolve = None
deadline = time.time() + float(args.get('wait', 90))
while True:
    try:
        resolve = dvr.scriptapp('Resolve')
    except Exception:
        resolve = None
    if resolve or time.time() > deadline:
        break
    time.sleep(2)
if not resolve:
    out(False, code='not_reachable')

pm = resolve.GetProjectManager()
name = args['name']
project = None
for i in range(1, 100):
    candidate = name if i == 1 else '%s %d' % (name, i)
    project = pm.CreateProject(candidate)
    if project:
        name = candidate
        break
if not project:
    out(False, code='no_project')

settings = {
    'timelineFrameRate': args['fps'],
    'timelineResolutionWidth': str(args['width']),
    'timelineResolutionHeight': str(args['height']),
}
try:
    if not project.SetSettings(settings):
        raise Exception('SetSettings refused')
except Exception:
    for key, value in settings.items():
        project.SetSetting(key, value)

pool = project.GetMediaPool()
timeline = pool.ImportTimelineFromFile(args['timeline'], {'timelineName': args['timelineName'], 'importSourceClips': True})
if not timeline:
    out(False, code='import_failed', project=name)
project.SetCurrentTimeline(timeline)

subtitles = 'none'
if args.get('srt'):
    items = []
    try:
        items = pool.ImportMedia([{'FilePath': args['srt']}]) or []
    except Exception:
        items = pool.ImportMedia([args['srt']]) or []
    subtitles = 'pool' if items else 'failed'
    if items:
        try:
            placed = pool.AppendToTimeline([{'mediaPoolItem': items[0], 'recordFrame': timeline.GetStartFrame()}]) or []
            kinds = [p.GetTrackTypeAndIndex()[0] for p in placed]
            if placed and all(k == 'subtitle' for k in kinds):
                subtitles = 'timeline'
            elif placed:
                # It landed on a picture or sound track: taken back off, the subtitles stay in the Media Pool.
                timeline.DeleteClips(placed)
        except Exception:
            pass

pm.SaveProject()
resolve.OpenPage('edit')
out(True, project=name, subtitles=subtitles)
`;

/** Where Resolve keeps its own Python and its scripting files, for the app at `app` (Resolve.exe or the .app). */
export const resolveScripting = (app, platform = process.platform, env = process.env) => {
  if (platform === 'win32') {
    const dir = path.dirname(app);
    const programData = env.PROGRAMDATA || env.ProgramData || 'C:\\ProgramData';
    return {
      python: path.join(dir, 'ResolvePython', 'ResolvePython.exe'),
      api: path.join(programData, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting'),
      lib: path.join(dir, 'fusionscript.dll'),
    };
  }
  if (platform === 'darwin') {
    return {
      python: path.join(app, 'Contents', 'Applications', 'ResolvePython'),
      api: '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting',
      lib: path.join(app, 'Contents', 'Libraries', 'Fusion', 'fusionscript.so'),
    };
  }
  return { python: '/opt/resolve/bin/ResolvePython', api: '/opt/resolve/Developer/Scripting', lib: '/opt/resolve/libs/Fusion/fusionscript.so' };
};

/** The timeline's picture size, from its FCPXML's own format. */
export const fcpxmlFormat = (text) => {
  const m = /<format id="r1"[^>]*\bwidth="(\d+)" height="(\d+)"/.exec(String(text || ''));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1080 };
};

/** What each failure means for the person, and what to do about it. */
export const STUDIO_ERRORS = {
  no_python: "DHVANI couldn't find Resolve's Python. Reinstall DaVinci Resolve Studio, or install Python 3 (64-bit) from python.org, and try again.",
  no_module: "Resolve's scripting files aren't where they should be. Reinstall DaVinci Resolve Studio and try again.",
  not_reachable:
    "Resolve didn't answer. In Resolve Studio, turn on Preferences › System › General › External scripting using: Local, restart Resolve and try again. The free version can't do this: use File › Import › Timeline.",
  no_project: 'Resolve would not make a new project. Check that a project library is open in the Project Manager and try again.',
  import_failed: 'Resolve made the project but could not import the timeline. Import it by hand with File › Import › Timeline.',
  failed: 'Opening in Resolve stopped unexpectedly. Use File › Import › Timeline instead.',
};

/** Python interpreters to try: Resolve's own first (no setup needed), then one on this computer. */
const interpreters = (scripting) => {
  const list = [];
  if (fs.existsSync(scripting.python)) list.push({ cmd: scripting.python, args: [], own: true });
  if (process.platform === 'win32') list.push({ cmd: 'py', args: ['-3'] }, { cmd: 'python', args: [] });
  else list.push({ cmd: 'python3', args: [] });
  return list;
};

const runOnce = ({ cmd, args }, script, input, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, [...args, script], { windowsHide: true });
    } catch {
      return resolve({ started: false });
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => {
      if (stderr.length < 4000) stderr += c.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ started: false });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).pop() || '';
      try {
        resolve({ started: true, result: JSON.parse(line) });
      } catch {
        resolve({ started: true, result: null, stderr });
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });

let busy = false;

/**
 * Runs the open script; resolves with { ok, project?, subtitles?, code? }.
 * `wait` is how long it waits for Resolve to answer (it may still be starting).
 */
export const openInResolveStudio = async ({ app, timeline, srt, name, timelineName, fps, width, height, wait = 90 }) => {
  if (busy) return { ok: false, code: 'busy' };
  busy = true;
  const script = path.join(os.tmpdir(), `dhvani-resolve-open-${process.pid}.py`);
  try {
    await fs.promises.writeFile(script, OPEN_SCRIPT, 'utf8');
    const scripting = resolveScripting(app);
    for (const interpreter of interpreters(scripting)) {
      const input = { timeline, srt: srt || null, name, timelineName, fps, width, height, wait, ...(interpreter.own ? {} : { api: scripting.api, lib: scripting.lib }) };
      const run = await runOnce(interpreter, script, input, (wait + 60) * 1000);
      if (!run.started) continue;
      if (run.result) return run.result;
      // It started but printed nothing usable: Python too old, or the script crashed.
      if (!interpreter.own) continue;
      return { ok: false, code: 'failed', detail: run.stderr?.slice(-400) };
    }
    return { ok: false, code: 'no_python' };
  } finally {
    busy = false;
    fs.promises.rm(script, { force: true }).catch(() => {});
  }
};
