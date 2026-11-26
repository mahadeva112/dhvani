import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * Open in DaVinci, one click, for the free Resolve.
 *
 * Free Resolve takes no outside scripting, but a script run from its own
 * Workspace › Scripts menu gets the full scripting API (checked on Resolve
 * 21.2.0.6, 2026-11-26: CreateProject, SetSetting, ImportTimelineFromFile,
 * ImportMedia, AppendToTimeline, SaveProject all work). So DHVANI puts a
 * "DHVANI" script in Resolve's Scripts folder and a job file beside its own
 * settings; the script reads the job, does the import and writes a result
 * file DHVANI reads back. On Windows DHVANI also presses Workspace › Scripts ›
 * DHVANI itself; anywhere it can't, the person chooses it in Resolve.
 *
 * Since 21.1 menu scripts run sandboxed (no io, loadfile, os.remove), so files
 * go through Fusion's own OpenFile, and the job is a data-only Lua table.
 */

export const SCRIPT_NAME = 'DHVANI';
export const SCRIPT_VERSION = 1;

/**
 * A Lua string literal for any text: printable ASCII as is, every other byte as
 * \ddd. Always three digits: Lua reads up to three, so "\92" before "77"
 * would be read as \927 and the whole script would fail to compile.
 */
export const luaString = (value) => {
  let out = '"';
  for (const byte of Buffer.from(String(value ?? ''), 'utf8')) {
    out += byte >= 0x20 && byte < 0x7f && byte !== 0x22 && byte !== 0x5c ? String.fromCharCode(byte) : `\\${String(byte).padStart(3, '0')}`;
  }
  return `${out}"`;
};

/** The job the script reads: a Lua table literal with strings and numbers only. */
export const buildJob = (job) => {
  const fields = Object.entries(job)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `  ${k} = ${typeof v === 'number' && Number.isFinite(v) ? String(v) : luaString(v)},`);
  return `return {\n${fields.join('\n')}\n}\n`;
};

/** The result the script writes: key=value lines, ending in END once it is whole. */
export const parseResult = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const result = { complete: lines.some((l) => l.trim() === 'END') };
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at > 0) result[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return result;
};

/** Resolve's own Scripts › Utility folder for this user: what shows in Workspace › Scripts. */
export const resolveScriptsFolder = (platform = process.platform, env = process.env, home = os.homedir()) => {
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Utility');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts', 'Utility');
  return path.join(home, '.local', 'share', 'DaVinciResolve', 'Fusion', 'Scripts', 'Utility');
};

/** The script Resolve runs. The job and result paths are written into it. */
export const buildScript = ({ jobPath, resultPath }) => String.raw`-- DHVANI for DaVinci Resolve (Workspace > Scripts > DHVANI), script version ${SCRIPT_VERSION}.
-- Written by the DHVANI app, which rewrites it: changes made here are lost.
-- Brings the timeline DHVANI last exported into a new project: the open project is saved first,
-- a new one is made at the timeline's frame rate and size, the timeline and its media come in,
-- the subtitles go on a subtitle track, the Edit page opens and the project is saved.
local JOB = ${luaString(jobPath)}
local RESULT = ${luaString(resultPath)}
local fu_ = fusion or fu
local rv = resolve or (fu_ and fu_:GetResolve())
local function try(fn) local ok, a = pcall(fn); if ok then return a end; return nil end
local function clean(v) return (tostring(v == nil and "" or v):gsub("[\r\n]", " ")) end

local function write(fields)
  pcall(function()
    local f = fu_:OpenFile(RESULT, 2)
    for _, kv in ipairs(fields) do f:WriteLine(kv[1] .. "=" .. clean(kv[2])) end
    f:WriteLine("END")
    pcall(function() f:Flush() end)
    f:Close()
  end)
end

local function read_lines(p)
  local f = try(function() return fu_:OpenFile(p, 1) end)
  if not f then return nil end
  local lines = {}
  pcall(function()
    while #lines < 10000 do
      local line = f:ReadLine()
      if line == nil then break end
      lines[#lines + 1] = line
    end
  end)
  pcall(function() f:Close() end)
  return lines
end

-- Resolve's Lua tables are not always {index = object}; keep only the objects.
local function objects(t)
  local out = {}
  for k, v in pairs(t or {}) do
    if type(v) == "userdata" then out[#out + 1] = v elseif type(k) == "userdata" then out[#out + 1] = k end
  end
  return out
end

if not fu_ or not rv then print("DHVANI: this Resolve did not give the script its scripting API."); return end
local lines = bmd.fileexists(JOB) and read_lines(JOB)
if not lines or #lines == 0 then
  print("DHVANI: nothing to import. In DHVANI, use Export for DaVinci first.")
  return
end
local compile = loadstring or load
local chunk = compile(table.concat(lines, "\n"), "=job")
if chunk and setfenv then setfenv(chunk, {}) end
local job = chunk and try(chunk)
if type(job) ~= "table" or not job.id or not job.timeline then print("DHVANI: the job file could not be read."); return end

local last = read_lines(RESULT) or {}
for _, l in ipairs(last) do
  if l == "id=" .. job.id then
    for _, m in ipairs(last) do
      if m == "status=ok" then print("DHVANI: this export is already in Resolve. Export again in DHVANI to bring it in once more."); return end
    end
  end
end
write({ { "id", job.id }, { "status", "running" } })

local function fail(code, message, extra)
  local fields = { { "id", job.id }, { "status", "failed" }, { "code", code }, { "message", message } }
  for _, kv in ipairs(extra or {}) do fields[#fields + 1] = kv end
  write(fields)
  print("DHVANI: " .. message)
end

local ok, err = pcall(function()
  local pm = rv:GetProjectManager()
  local current = try(function() return pm:GetCurrentProject() end)
  local project
  -- DHVANI makes the project itself when Resolve showed the Project Manager; it is empty then.
  if current and job.madeProject and current:GetName() == job.madeProject and (try(function() return current:GetTimelineCount() end) or 0) == 0 then
    project = current
  else
    if current then try(function() return pm:SaveProject() end) end
    for i = 1, 99 do
      local name = i == 1 and job.project or (job.project .. " " .. i)
      project = try(function() return pm:CreateProject(name) end)
      if project then break end
    end
  end
  if not project then return fail("no_project", "Resolve would not make a new project. Open a project library in the Project Manager and try again.") end
  local name = project:GetName()

  try(function() return project:SetSetting("timelineFrameRate", tostring(job.fps)) end)
  if job.width then try(function() return project:SetSetting("timelineResolutionWidth", tostring(job.width)) end) end
  if job.height then try(function() return project:SetSetting("timelineResolutionHeight", tostring(job.height)) end) end

  local pool = project:GetMediaPool()
  local timeline = try(function() return pool:ImportTimelineFromFile(job.timeline, { timelineName = job.timelineName, importSourceClips = true }) end)
  if not timeline then return fail("import_failed", "Resolve made the project but could not import the timeline. Use File > Import > Timeline.", { { "project", name } }) end
  try(function() return project:SetCurrentTimeline(timeline) end)

  local subtitles = "none"
  if job.srt then
    local item = objects(try(function() return pool:ImportMedia({ job.srt }) end))[1]
    subtitles = item and "pool" or "failed"
    if item then
      local placed = objects(try(function() return pool:AppendToTimeline({ { mediaPoolItem = item, recordFrame = timeline:GetStartFrame() } }) end))
      local all_subtitle = #placed > 0
      for _, clip in ipairs(placed) do
        local a = try(function() return clip:GetTrackTypeAndIndex() end)
        local kind = type(a) == "table" and (a[1] or a["1"]) or a
        if kind ~= "subtitle" then all_subtitle = false end
      end
      if all_subtitle then subtitles = "timeline"
      elseif #placed > 0 then try(function() return timeline:DeleteClips(placed) end) end
    end
  end

  try(function() return rv:OpenPage("edit") end)
  local saved = try(function() return pm:SaveProject() end)
  write({
    { "id", job.id }, { "status", "ok" }, { "project", name }, { "timeline", try(function() return timeline:GetName() end) },
    { "fps", try(function() return timeline:GetSetting("timelineFrameRate") end) },
    { "video", try(function() return timeline:GetTrackCount("video") end) }, { "audio", try(function() return timeline:GetTrackCount("audio") end) },
    { "subtitles", subtitles }, { "saved", saved and "yes" or "no" },
  })
  print("DHVANI: imported into the project " .. name .. ".")
end)
if not ok then fail("script_error", "The DHVANI script stopped: " .. tostring(err)) end
`;

/** Puts the script where Workspace › Scripts lists it; rewrites it only when it changed. */
export const installScript = async ({ folder = resolveScriptsFolder(), jobPath, resultPath }) => {
  const file = path.join(folder, `${SCRIPT_NAME}.lua`);
  const body = buildScript({ jobPath, resultPath });
  const old = await fs.promises.readFile(file, 'utf8').catch(() => null);
  if (old !== body) {
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(file, body, 'utf8');
  }
  return file;
};

/**
 * Presses Workspace › Scripts › DHVANI in Resolve on Windows, through UI
 * Automation. Resolve showing the Project Manager has no menus, so a new
 * project is made there first (its name comes in as madeProject). Presses run
 * on their own runspace: a UIA Invoke that opens something modal in Resolve
 * holds the call until it closes.
 */
export const TRIGGER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DhvaniWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  // Brings Resolve forward: its menus only open for the window in front.
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    uint pid;
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fg, false);
    return GetForegroundWindow() == h;
  }
  public static List<string> Visible(uint want) {
    var list = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want && IsWindowVisible(h)) {
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        list.Add(h.ToInt64() + "|" + c + "|" + t);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$TS = [System.Windows.Automation.TreeScope]::Descendants
$resolvePid = 0
$madeProject = $null
$runspaces = New-Object System.Collections.ArrayList

function Emit($ok, $code, $message) {
  [ordered]@{ ok = $ok; code = $code; message = $message; madeProject = $madeProject } | ConvertTo-Json -Compress | Write-Output
  exit
}
function Get-Windows() {
  if (-not $resolvePid) { return @() }
  return @([DhvaniWin]::Visible([uint32]$resolvePid) | ForEach-Object {
    $parts = $_.Split('|', 3)
    [pscustomobject]@{ Handle = [IntPtr][long]$parts[0]; Class = $parts[1]; Title = $parts[2] }
  })
}
function Wait-Window([scriptblock]$match, [int]$seconds) {
  $until = [DateTime]::UtcNow.AddSeconds($seconds)
  do {
    $hit = Get-Windows | Where-Object $match | Select-Object -First 1
    if ($hit) { return $hit }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $until)
  return $null
}
function Find-Control($handle, $controlType, [string]$pattern) {
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
      $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)
      foreach ($el in $root.FindAll($TS, $cond)) { if (-not $pattern -or $el.Current.Name -match $pattern) { return $el } }
      return $null
    } catch { Start-Sleep -Milliseconds 300 }
  }
  return $null
}
function Find-MenuItem([string]$pattern) {
  foreach ($w in Get-Windows) {
    $item = Find-Control $w.Handle ([System.Windows.Automation.ControlType]::MenuItem) $pattern
    if ($item) { return $item }
  }
  return $null
}
function Press-NoWait($element) {
  $ps = [powershell]::Create()
  [void]$ps.AddScript({ param($e) try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {} }).AddArgument($element)
  [void]$ps.BeginInvoke()
  [void]$runspaces.Add($ps)
}
function Expand-Menu($item) {
  $ec = $null
  if ($item.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ec)) { $ec.Expand() } else { Press-NoWait $item }
}
function Window-Text($handle) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
    return (@($root.FindAll($TS, $cond) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' ').Trim()
  } catch { return '' }
}

try {
  $until = [DateTime]::UtcNow.AddSeconds([int]$inputData.wait)
  $pm = $null; $main = $null
  do {
    $proc = Get-Process -Name Resolve -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
      $resolvePid = $proc.Id
      $pm = Get-Windows | Where-Object { $_.Title -eq 'Project Manager' } | Select-Object -First 1
      $main = Get-Windows | Where-Object { $_.Title -like 'DaVinci Resolve - *' } | Select-Object -First 1
      if ($pm -or $main) { break }
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $until)
  if (-not $pm -and -not $main) { Emit $false 'not_running' 'Resolve did not open.' }

  if ($pm) {
    # The Project Manager has no Workspace menu: make the new project here.
    Start-Sleep -Milliseconds 800
    $newButton = Find-Control $pm.Handle ([System.Windows.Automation.ControlType]::Button) '^New Project$'
    if (-not $newButton) { Emit $false 'project_manager' 'The Project Manager showed no New Project button.' }
    Press-NoWait $newButton
    $dialog = Wait-Window { $_.Title -eq 'Create New Project' } 10
    if (-not $dialog) { Emit $false 'project_manager' 'Resolve did not open its Create New Project window.' }
    Start-Sleep -Milliseconds 300
    $nameBox = Find-Control $dialog.Handle ([System.Windows.Automation.ControlType]::Edit) $null
    $create = Find-Control $dialog.Handle ([System.Windows.Automation.ControlType]::Button) '^Create$'
    if (-not $nameBox -or -not $create) { Emit $false 'project_manager' 'The Create New Project window had no name box or Create button.' }
    $nameBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue([string]$inputData.projectName)
    Start-Sleep -Milliseconds 200
    Press-NoWait $create
    $wanted = 'DaVinci Resolve - ' + $inputData.projectName
    $main = Wait-Window { $_.Title -eq $wanted } 90
    if (-not $main) {
      $other = Get-Windows | Where-Object { $_.Title -and $_.Title -notlike 'DaVinci Resolve*' -and $_.Title -ne 'Project Manager' } | Select-Object -First 1
      $said = if ($other) { Window-Text $other.Handle } else { '' }
      Emit $false 'project_manager' ('Resolve did not open the new project.' + $(if ($said) { " Resolve says: $said" } else { '' }))
    }
    $madeProject = [string]$inputData.projectName
    Start-Sleep -Seconds 2
  }

  # Workspace > Scripts > DHVANI. Resolve opens a menu only for the window in front, and
  # sometimes not on the first try, so it is brought forward and asked up to three times.
  $workspace = Find-Control $main.Handle ([System.Windows.Automation.ControlType]::MenuItem) '^Workspace$'
  if (-not $workspace) { Emit $false 'menu' 'Resolve showed no Workspace menu.' }
  $scripts = $null
  for ($attempt = 0; $attempt -lt 3 -and -not $scripts; $attempt++) {
    [void][DhvaniWin]::Focus($main.Handle)
    Start-Sleep -Milliseconds 300
    if ($attempt -eq 1) { Press-NoWait $workspace } else { Expand-Menu $workspace }
    $until = [DateTime]::UtcNow.AddMilliseconds(1500)
    do { Start-Sleep -Milliseconds 250; $scripts = Find-MenuItem '^Scripts$' } while (-not $scripts -and [DateTime]::UtcNow -lt $until)
    if (-not $scripts) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 300 }
  }
  if (-not $scripts) { Emit $false 'menu' 'Resolve showed no Workspace > Scripts menu.' }
  $target = '^' + [regex]::Escape([string]$inputData.scriptName) + '$'
  $item = $null
  for ($attempt = 0; $attempt -lt 3 -and -not $item; $attempt++) {
    if ($attempt -gt 0) { $scripts = Find-MenuItem '^Scripts$' }
    if (-not $scripts) { break }
    if ($attempt -eq 0) { Expand-Menu $scripts }
    elseif ($attempt -eq 1) { Press-NoWait $scripts }
    else { try { $scripts.SetFocus() } catch {}; [System.Windows.Forms.SendKeys]::SendWait('{RIGHT}') }
    $until = [DateTime]::UtcNow.AddMilliseconds(1500)
    do { Start-Sleep -Milliseconds 250; $item = Find-MenuItem $target } while (-not $item -and [DateTime]::UtcNow -lt $until)
  }
  if (-not $item) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}{ESC}{ESC}'); Emit $false 'menu' 'Resolve did not list the DHVANI script.' }
  Press-NoWait $item
  # Stay until the script has written this job's id, so the press is not dropped with this process.
  $until = [DateTime]::UtcNow.AddSeconds(20)
  $marker = 'id=' + [string]$inputData.jobId
  do {
    Start-Sleep -Milliseconds 300
    $seen = (Test-Path -LiteralPath $inputData.resultPath) -and ((Get-Content -LiteralPath $inputData.resultPath -ErrorAction SilentlyContinue) -contains $marker)
  } while (-not $seen -and [DateTime]::UtcNow -lt $until)
  if (-not $seen) { Emit $false 'not_started' 'Resolve listed the DHVANI script but did not start it.' }
  Emit $true 'started' ''
} catch {
  Emit $false 'trigger_error' $_.Exception.Message
}
`;

const runPowerShell = async (script, input, timeoutMs) => {
  let tempDir;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dhvani-resolve-'));
    const scriptPath = path.join(tempDir, 'press.ps1');
    // Windows PowerShell 5.1 reads a script as UTF-8 only with the BOM.
    await fs.promises.writeFile(scriptPath, `﻿${script}`, 'utf8');
    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      // Bypass only for this helper process; the machine's script policy is left alone.
      const child = spawn('powershell.exe', ['-NoProfile', '-Sta', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => child.kill(), timeoutMs);
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      child.stdout.on('data', (chunk) => { if (stdout.length < 12_000) stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { if (stderr.length < 4_000) stderr += chunk.toString(); });
      child.on('error', (error) => finish({ ok: false, code: 'powershell', message: error.message }));
      child.on('close', () => finish(parseTriggerOutput(stdout, stderr)));
      child.stdin.end(JSON.stringify(input));
    });
  } catch (error) {
    return { ok: false, code: 'powershell', message: error.message };
  } finally {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

/** The helper's last stdout line is its JSON result; anything else is a failure with stderr's first line. */
export const parseTriggerOutput = (stdout, stderr = '') => {
  const line = String(stdout).trim().split(/\r?\n/).pop() || '';
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean') return parsed;
  } catch {}
  return { ok: false, code: 'helper_output', message: String(stderr).trim().split(/\r?\n/)[0] || 'The helper returned nothing.' };
};

/** "<name> 2026-11-26 09.05": a name the Project Manager won't already have. */
export const stampedName = (name, now = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${name} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reads the script's result for job `id` until it is done or `ms` pass; `started` is false if the script never ran. */
export const waitForResult = async (resultPath, id, { ms, startMs, every = 500 }) => {
  const began = Date.now();
  let started = false;
  while (Date.now() - began < ms) {
    const result = parseResult(await fs.promises.readFile(resultPath, 'utf8').catch(() => ''));
    if (result.complete && result.id === id) {
      started = true;
      if (result.status === 'ok' || result.status === 'failed') return { ...result, started };
    }
    if (!started && startMs && Date.now() - began > startMs) return { started: false };
    await sleep(every);
  }
  return { started, status: started ? 'slow' : undefined };
};

/** What each outcome means for the person. */
export const FREE_MESSAGES = {
  click_needed: 'DHVANI could not start its script in Resolve. In Resolve, choose Workspace › Scripts › DHVANI: the export is waiting there.',
  slow: 'Resolve is still importing. Leave it to finish; the project saves itself at the end.',
  windows_only: 'In Resolve, choose Workspace › Scripts › DHVANI to bring this export in.',
};

let busy = false;

/**
 * Writes the job, installs the script and (on Windows) runs it in Resolve.
 * Resolves with { ok, project?, subtitles?, ... } or { ok: false, code, message }.
 */
export const openInResolveFree = async ({ configDir, timeline, srt, name, timelineName, fps, width, height, wait = 30 }) => {
  if (busy) return { ok: false, code: 'busy', message: 'DHVANI is already bringing an export into Resolve.' };
  busy = true;
  try {
    const dir = path.join(configDir, 'resolve');
    await fs.promises.mkdir(dir, { recursive: true });
    const jobPath = path.join(dir, 'job.lua');
    const resultPath = path.join(dir, 'result.txt');
    const id = randomUUID();
    const projectName = stampedName(name);
    await fs.promises.rm(resultPath, { force: true });
    await installScript({ jobPath, resultPath });

    if (process.platform !== 'win32') {
      await fs.promises.writeFile(jobPath, buildJob({ id, timeline, srt, project: name, timelineName, fps, width, height }), 'utf8');
      return { ok: false, code: 'windows_only', message: FREE_MESSAGES.windows_only };
    }
    // The job names the project DHVANI may make in the Project Manager, so the script uses that one.
    await fs.promises.writeFile(jobPath, buildJob({ id, timeline, srt, project: name, madeProject: projectName, timelineName, fps, width, height }), 'utf8');
    const pressed = await runPowerShell(TRIGGER_SCRIPT, { projectName, scriptName: SCRIPT_NAME, wait, resultPath, jobId: id }, (wait + 120) * 1000);
    if (!pressed.ok) return { ok: false, code: 'click_needed', message: `${FREE_MESSAGES.click_needed} (${pressed.message || pressed.code})` };

    const result = await waitForResult(resultPath, id, { ms: 240_000, startMs: 20_000 });
    if (!result.started) return { ok: false, code: 'click_needed', message: FREE_MESSAGES.click_needed };
    if (result.status === 'slow') return { ok: false, code: 'slow', message: FREE_MESSAGES.slow };
    if (result.status !== 'ok') return { ok: false, code: result.code || 'failed', message: result.message || 'The DHVANI script in Resolve stopped.' };
    return {
      ok: true,
      project: result.project,
      timeline: result.timeline,
      subtitles: result.subtitles || 'none',
      saved: result.saved === 'yes',
    };
  } finally {
    busy = false;
  }
};
