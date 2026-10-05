/**
 * Minimal RIFF/WAVE writer.
 *
 * Gemini returns bare PCM frames; browsers need a container before they will
 * decode or play the result.
 */
export const pcmToWav = (pcmBuffer, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) => {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
};

/**
 * Reads a mono WAV that pcmToWav (16-bit) or floatToWav (32-bit float) wrote,
 * back to float samples exactly as they were written: 16-bit as pcm16ToFloat
 * reads it, one scale for both signs. Returns `{ sampleRate, float, samples }`;
 * throws on anything else.
 */
export const parseWav = (buffer) => {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file.');
  }
  let format = null;
  for (let at = 12; at + 8 <= buffer.length; ) {
    const id = buffer.toString('ascii', at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      format = {
        code: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format || format.channels !== 1) throw new Error('Only mono WAV is read here.');
      const end = Math.min(buffer.length, body + size);
      if (format.code === 1 && format.bits === 16) {
        const samples = new Float32Array(Math.floor((end - body) / 2));
        for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(body + i * 2) / 32768;
        return { sampleRate: format.sampleRate, float: false, samples };
      }
      if (format.code === 3 && format.bits === 32) {
        const samples = new Float32Array(Math.floor((end - body) / 4));
        for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(body + i * 4);
        return { sampleRate: format.sampleRate, float: true, samples };
      }
      throw new Error('Only 16-bit PCM or 32-bit float WAV is read here.');
    }
    at = body + size + (size % 2);
  }
  throw new Error('The WAV file has no audio.');
};

/**
 * Mono 32-bit float WAV, written straight from the samples: nothing is
 * rounded, scaled or clipped, so a mix that peaks above full scale is kept
 * exactly as summed.
 */
export const floatToWav = (samples, { sampleRate }) => {
  const data = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; i++) data.writeFloatLE(samples[i], i * 4);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};
