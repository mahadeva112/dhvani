/// <reference lib="webworker" />
/**
 * Reads a plain PCM WAV through for its peaks and gate levels off the page
 * (services/audioService.ts scanPcm, scanInWorker). Told where the bytes are
 * (a Blob, or a file the server keeps), it answers with the scan, its arrays
 * handed over rather than copied, or with the error reading it gave.
 */
import { bytesOf, scanPcm, type ByteOrigin, type PcmScan } from './audioService.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The buffers a scan's arrays sit on, to hand over with it. */
const buffersOf = (scan: PcmScan | null): ArrayBuffer[] =>
  scan
    ? [
        ...scan.peaks.levels.flatMap((level) => [level.max.buffer, level.min.buffer]),
        ...(scan.peaks.data ? [scan.peaks.data.buffer] : []),
        ...(scan.levels ? [scan.levels.levels.buffer] : []),
      ].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer)
    : [];

scope.onmessage = async (event: MessageEvent<{ origin: ByteOrigin; levels: boolean }>) => {
  try {
    const scan = await scanPcm(bytesOf(event.data.origin), { levels: event.data.levels });
    scope.postMessage({ scan }, [...new Set(buffersOf(scan))]);
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
