import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Keeps the Express backend alive for as long as the Vite dev server runs.
 *
 * Vite happily serves the UI on its own, so starting only the client left the
 * app looking perfectly healthy while every /api call failed with "Failed to
 * fetch" — the frontend has no way to distinguish a missing backend from a
 * broken gateway, so the error surfaced on whatever settings field was being
 * saved at the time. Owning the backend process here means the two can no
 * longer be started out of step.
 *
 * A backend that is already listening is left strictly alone: `npm run server`
 * in another terminal, the desktop shell, or the login task all keep ownership
 * of their own process, and this plugin stands down.
 */

const PROBE_INTERVAL_MS = 250;
const STARTUP_TIMEOUT_MS = 30_000;
const RESTART_DELAY_MS = 1_000;
const MONITOR_INTERVAL_MS = 5_000;
const KILL_GRACE_MS = 2_000;

/**
 * Consecutive failed probes before the backend is considered dead.
 *
 * Two is enough to ride out the sub-second gap while `--watch` reloads the
 * server after a file edit, without waiting long on a genuine crash.
 */
const FAILURES_BEFORE_RESTART = 2;

/**
 * How many restarts to attempt before giving up.
 *
 * A backend that dies on a syntax error would otherwise respawn forever,
 * burying the actual stack trace under its own restart chatter.
 */
const MAX_RESTARTS = 5;

/** True when something answers the backend's health endpoint. */
const isBackendUp = async (healthUrl) => {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const autoStartBackend = ({ root, port, host = '127.0.0.1', watch = false }) => {
  const healthUrl = `http://${host}:${port}/api/health`;
  const entry = path.join(root, 'server', 'index.js');

  let child = null;
  let monitor = null;
  let shuttingDown = false;
  let recycling = false;
  let restarts = 0;
  let failures = 0;
  let log = console;

  const info = (message) => log.info(`[backend] ${message}`);
  const warn = (message) => log.warn(`[backend] ${message}`);

  /** Forwards child output line by line so it interleaves readably with Vite's. */
  const pipe = (stream, write) => {
    let buffer = '';
    stream?.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) write(`[backend] ${line}`);
    });
  };

  const spawnBackend = () => {
    child = spawn(process.execPath, watch ? ['--watch', entry] : [entry], {
      cwd: root,
      env: {
        ...process.env,
        // Pinned so the child cannot resolve a different port than the one
        // /api is proxied to, whatever PORT happens to mean in the shell.
        PORT: String(port),
        HOST: host,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pipe(child.stdout, (line) => log.info(line));
    pipe(child.stderr, (line) => log.warn(line));

    child.on('error', (err) => warn(`could not be started: ${err.message}`));

    child.on('exit', (code) => {
      child = null;
      // A deliberate stop or restart handles its own follow-up.
      if (shuttingDown || recycling) return;
      void restart(`exited (code ${code})`);
    });
  };

  /** Stops the current child, resolving once it is actually gone. */
  const killChild = () => {
    const dying = child;
    child = null;
    if (!dying || dying.exitCode !== null || dying.signalCode !== null) return Promise.resolve();

    return new Promise((resolve) => {
      const hardKill = setTimeout(() => {
        try {
          dying.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }, KILL_GRACE_MS);

      dying.once('exit', () => {
        clearTimeout(hardKill);
        resolve();
      });

      dying.kill('SIGTERM');
    });
  };

  /**
   * Replaces the backend process, whether it exited or merely stopped
   * answering.
   *
   * The second case is the one that matters: under `--watch`, a crashed server
   * leaves the watcher alive and idle ("waiting for file changes"), so the
   * child never exits and only a health probe reveals that nothing is
   * listening any more.
   */
  const restart = async (reason) => {
    if (shuttingDown || recycling) return;

    if (restarts >= MAX_RESTARTS) {
      warn(`${reason} and has failed ${MAX_RESTARTS} times — not restarting again.`);
      warn('Fix the error above, then restart the dev server.');
      stopMonitor();
      return;
    }

    restarts += 1;
    recycling = true;
    warn(`${reason} — restarting (${restarts}/${MAX_RESTARTS})…`);

    try {
      await killChild();
      await delay(RESTART_DELAY_MS);
      if (shuttingDown) return;
      spawnBackend();
    } finally {
      recycling = false;
    }

    await waitForHealth();
  };

  /** Resolves once the backend answers, or warns if it never does. */
  const waitForHealth = async () => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (shuttingDown) return false;
      if (await isBackendUp(healthUrl)) {
        failures = 0;
        info(`ready on http://${host}:${port}`);
        return true;
      }
      await delay(PROBE_INTERVAL_MS);
    }
    warn(`did not answer ${healthUrl} within ${STARTUP_TIMEOUT_MS / 1000}s.`);
    return false;
  };

  const stopMonitor = () => {
    if (monitor) clearInterval(monitor);
    monitor = null;
  };

  const startMonitor = () => {
    stopMonitor();
    monitor = setInterval(async () => {
      if (shuttingDown || recycling) return;

      if (await isBackendUp(healthUrl)) {
        failures = 0;
        return;
      }

      failures += 1;
      if (failures < FAILURES_BEFORE_RESTART) return;

      failures = 0;
      await restart('stopped answering');
    }, MONITOR_INTERVAL_MS);

    // Never hold the dev server open on our account.
    monitor.unref?.();
  };

  const stop = () => {
    shuttingDown = true;
    stopMonitor();
    void killChild();
  };

  const ensureRunning = async (server) => {
    log = server.config.logger ?? console;

    if (process.env.DHVANI_NO_AUTO_BACKEND === '1') {
      info('auto-start disabled by DHVANI_NO_AUTO_BACKEND.');
      return;
    }

    if (await isBackendUp(healthUrl)) {
      info(`already running on http://${host}:${port} — leaving it alone.`);
      return;
    }

    info(`starting on port ${port}…`);
    spawnBackend();
    await waitForHealth();
    startMonitor();
  };

  const bindCleanup = (server) => {
    server.httpServer?.once('close', stop);
    process.once('exit', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  };

  return {
    name: 'dhvani:auto-start-backend',

    configureServer(server) {
      bindCleanup(server);
      // Not awaited: the UI should render immediately and show its own
      // "backend offline" state while the child is still booting.
      void ensureRunning(server);
    },

    configurePreviewServer(server) {
      bindCleanup(server);
      void ensureRunning(server);
    },
  };
};
