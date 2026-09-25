

import { AudioMetadata, AudioSegment } from '../types';

export interface AudioAnalysisOptions {
  sensitivity?: number; // 0 to 100 (Default: 50)
  silenceThreshold?: number; // Custom override for amplitude threshold
  minSilenceDuration?: number; // Custom override for min silence in seconds
  minSpeechDuration?: number; // Custom override for min speech in seconds
}

export interface SensitivityProfile {
  sensitivity: number;
  label: string;
  category: 'Coarse' | 'Balanced' | 'Sensitive' | 'Micro-Pauses';
  silenceThreshold: number;
  minSilenceDuration: number;
  minSpeechDuration: number;
  description: string;
}

/**
 * Calculates acoustic VAD thresholds from a 0-100 sensitivity value.
 * - Higher sensitivity = lower silence threshold (fainter audio counted) + shorter pause duration required to trigger a split.
 * - Lower sensitivity = higher threshold + longer silence required before breaking dialogue.
 */
export const getSensitivityProfile = (sensitivity: number = 50): SensitivityProfile => {
  const s = Math.max(0, Math.min(100, Math.round(sensitivity)));
  const t = s / 100; // 0.0 to 1.0

  // 1. Silence amplitude threshold (logarithmic scale):
  // At 0: ~0.022 (high barrier, ignores faint sounds/breaths)
  // At 50: ~0.008 (standard studio dialogue threshold)
  // At 100: ~0.0022 (ultra-sensitive to subtle speech drops)
  const silenceThreshold = Number((0.022 * Math.pow(0.1, t * 0.95)).toFixed(4));

  // 2. Minimum pause duration required to trigger a split (seconds):
  // At 0: ~0.42s (420ms - only long dramatic pauses cause cuts)
  // At 50: ~0.13s (130ms - natural sentence breaks and breath pauses)
  // At 100: ~0.05s (50ms - splits at virtually any vocal pause / micro-break)
  const minSilenceDuration = Number((0.05 + 0.37 * Math.pow(1 - t, 1.3)).toFixed(3));

  // 3. Minimum speech duration for a valid segment (seconds):
  // At 0: ~0.25s
  // At 50: ~0.14s
  // At 100: ~0.06s (catches 1-syllable interjections)
  const minSpeechDuration = Number((0.06 + 0.19 * (1 - t)).toFixed(3));

  let category: SensitivityProfile['category'] = 'Balanced';
  let label = 'Balanced (Natural Pauses)';
  let description = 'Default dialogue threshold (~130ms pause). Ideal for standard podcasts, narrations, and conversations.';

  if (s <= 25) {
    category = 'Coarse';
    label = 'Coarse (Long Pauses Only)';
    description = `Long pause threshold (~${Math.round(minSilenceDuration * 1000)}ms). Groups sentences and phrases into continuous blocks.`;
  } else if (s >= 80) {
    category = 'Micro-Pauses';
    label = 'Micro-Pauses (Fine Cuts)';
    description = `Ultra-fine pause threshold (~${Math.round(minSilenceDuration * 1000)}ms). Catches micro-pauses, short breaths, and rapid exchanges.`;
  } else if (s > 55) {
    category = 'Sensitive';
    label = 'Sensitive (Short Pauses)';
    description = `Short pause threshold (~${Math.round(minSilenceDuration * 1000)}ms). Catches fast cadence dialogue and short breath stops.`;
  }

  return {
    sensitivity: s,
    label,
    category,
    silenceThreshold,
    minSilenceDuration,
    minSpeechDuration,
    description,
  };
};

/**
 * Decodes an audio file and detects speech segments based on silence and sensitivity.
 * Uses an energy-based Voice Activity Detection (VAD) algorithm.
 */
export const analyzeAudio = async (
  file: File,
  options?: AudioAnalysisOptions
): Promise<{ segments: AudioSegment[]; buffer: AudioBuffer; metadata: AudioMetadata }> => {
  // 1. Basic type check
  if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
    throw new Error("Invalid file type. Please upload an audio (MP3, WAV, etc.) or video file.");
  }

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (e) {
    throw new Error("Failed to read the file. It may be corrupt or inaccessible.");
  }

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    // 2. Decode Audio
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // 3. Detect Segments with configurable sensitivity
    const segments = detectSpeechSegments(audioBuffer, options);
    
    const metadata: AudioMetadata = {
      duration: audioBuffer.duration,
      fileName: file.name,
      fileType: file.type || 'audio/wav',
    };

    return { segments, buffer: audioBuffer, metadata };
  } catch (error: any) {
    // Handle specific decoding errors
    console.error("Audio Analysis Error:", error);
    if (error.name === 'EncodingError' || error.message?.includes('Unable to decode')) {
      throw new Error("Browser unable to decode audio. Try converting to MP3 or WAV.");
    }
    throw new Error(error.message || "Failed to analyze audio file.");
  } finally {
    if (audioContext.state !== 'closed') {
      await audioContext.close();
    }
  }
};

/**
 * Decodes a blob URL into an AudioBuffer.
 */
export const decodeAudioBlobUrl = async (blobUrl: string): Promise<AudioBuffer> => {
    const response = await fetch(blobUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      return await audioContext.decodeAudioData(arrayBuffer);
    } finally {
      if (audioContext.state !== 'closed') {
        await audioContext.close();
      }
    }
};

/**
 * Converts an AudioBuffer to a WAV Blob.
 */
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + buffer.length * numOfChan * 2, true);
  writeString(view, 8, 'WAVE');

  // write fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);

  // write data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, buffer.length * numOfChan * 2, true);

  // write the PCM samples
  for(i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  offset = 44;
  while(pos < buffer.length){
    for(i = 0; i < numOfChan; i++){
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([view], { type: 'audio/wav' });
};

/**
 * Creates a WAV Blob from raw PCM 16-bit data.
 * Used for Gemini TTS output which provides raw PCM.
 */
export const createWavBlobFromPcm = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1): Blob => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * numChannels * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, numChannels * 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, pcmData.length, true);

  // Combine header and data
  return new Blob([view, pcmData], { type: 'audio/wav' });
};

function writeString(view: DataView, offset: number, string: string){
  for (let i = 0; i < string.length; i++){
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Detects speech segments by analyzing PCM data amplitude with customizable sensitivity.
 */
export const detectSpeechSegments = (
  buffer: AudioBuffer,
  options?: AudioAnalysisOptions
): AudioSegment[] => {
  const profile = getSensitivityProfile(options?.sensitivity ?? 50);

  const silenceThreshold = options?.silenceThreshold ?? profile.silenceThreshold;
  const minSilenceDuration = options?.minSilenceDuration ?? profile.minSilenceDuration;
  const minSpeechDuration = options?.minSpeechDuration ?? profile.minSpeechDuration;

  const channelData = buffer.getChannelData(0); // Analyze first channel (mono)
  const sampleRate = buffer.sampleRate;

  const segments: AudioSegment[] = [];
  let isSpeech = false;
  let speechStartSample = 0;

  // Stride helps performance on large files while maintaining high accuracy
  const stride = 100;

  for (let i = 0; i < channelData.length; i += stride) {
    const amplitude = Math.abs(channelData[i]);

    if (amplitude > silenceThreshold) {
      if (!isSpeech) {
        // Potential start of speech
        isSpeech = true;
        speechStartSample = i;
      }
    } else {
      if (isSpeech) {
        // Potential end of speech
        // Look ahead to see if it's just a brief dip in volume or actual silence
        let isActuallySilence = true;
        const lookAheadSamples = Math.floor(minSilenceDuration * sampleRate);
        const checkLimit = Math.min(channelData.length, i + lookAheadSamples);

        for (let j = i; j < checkLimit; j += stride) {
          if (Math.abs(channelData[j]) > silenceThreshold) {
            isActuallySilence = false;
            break;
          }
        }

        if (isActuallySilence) {
          isSpeech = false;
          const endTime = i / sampleRate;
          const startTime = speechStartSample / sampleRate;
          const duration = endTime - startTime;

          if (duration >= minSpeechDuration) {
            segments.push({
              id: segments.length + 1,
              startTime: Number(startTime.toFixed(3)),
              endTime: Number(endTime.toFixed(3)),
              duration: Number(duration.toFixed(3)),
            });
          }
        }
      }
    }
  }

  // Handle case where file ends with speech
  if (isSpeech) {
    const startTime = speechStartSample / sampleRate;
    const endTime = channelData.length / sampleRate;
    if (endTime - startTime >= minSpeechDuration) {
      segments.push({
        id: segments.length + 1,
        startTime: Number(startTime.toFixed(3)),
        endTime: Number(endTime.toFixed(3)),
        duration: Number((endTime - startTime).toFixed(3)),
      });
    }
  }

  return segments;
};

/**
 * Re-analyzes an existing AudioBuffer at a new sensitivity setting,
 * preserving any already transcribed / translated dialogue text from previous segments.
 */
export const resegmentAudioBuffer = (
  buffer: AudioBuffer,
  sensitivity: number,
  previousSegments: AudioSegment[] = []
): AudioSegment[] => {
  // Transcribed cues are timed by ElevenLabs word timestamps. Re-cutting them
  // on local VAD boundaries keeps only one cue's text per new segment and
  // silently drops the rest of the transcript, so they are never re-cut here.
  const hasTranscript = previousSegments.some(
    (seg) => (seg.textSource || seg.textTarget || '').trim().length > 0
  );
  if (hasTranscript) return previousSegments;

  const newSegments = detectSpeechSegments(buffer, { sensitivity });

  if (previousSegments.length === 0 || newSegments.length === 0) {
    return newSegments;
  }

  // Smart text mapping: transfer existing textSource, textTarget, emotion, and speaker
  return newSegments.map((newSeg) => {
    const newMid = (newSeg.startTime + newSeg.endTime) / 2;

    // Find previous segment that contains the midpoint of this new segment
    const matchedPrev = previousSegments.find(
      (prev) => newMid >= prev.startTime && newMid <= prev.endTime
    ) || previousSegments.find(
      // Or has greatest overlap
      (prev) =>
        Math.max(0, Math.min(newSeg.endTime, prev.endTime) - Math.max(newSeg.startTime, prev.startTime)) > 0.1
    );

    if (matchedPrev) {
      return {
        ...newSeg,
        textSource: matchedPrev.textSource,
        textTarget: matchedPrev.textTarget,
        emotion: matchedPrev.emotion,
        speaker: matchedPrev.speaker,
        speedRate: matchedPrev.speedRate,
      };
    }

    return newSeg;
  });
};

export type VoiceEffectPreset = 'deep' | 'high' | 'robot' | 'radio' | 'studio' | 'whisper';

/**
 * Applies client-side audio DSP voice modulation to an AudioBuffer
 * using Web Audio OfflineAudioContext.
 */
export const applyVoiceEffectToBuffer = async (
  sourceBuffer: AudioBuffer,
  effect: VoiceEffectPreset
): Promise<AudioBuffer> => {
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;

  // For pitch-shifting via playback rate resampling:
  let rate = 1.0;
  if (effect === 'deep') rate = 0.82; // Lower pitch
  if (effect === 'high') rate = 1.22; // Higher pitch

  const targetLength = Math.ceil(sourceBuffer.length / rate);
  const offlineCtx = new OfflineAudioContext(numChannels, targetLength, sampleRate);

  // Buffer source
  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = rate;

  let lastNode: AudioNode = source;

  if (effect === 'deep') {
    // Warm low-shelf boost + gentle high rolloff
    const bass = offlineCtx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 220;
    bass.gain.value = 7.0;

    const highRolloff = offlineCtx.createBiquadFilter();
    highRolloff.type = 'lowpass';
    highRolloff.frequency.value = 5500;

    lastNode.connect(bass);
    bass.connect(highRolloff);
    lastNode = highRolloff;
  } else if (effect === 'high') {
    // High-shelf boost for crisp youthful timbre
    const treble = offlineCtx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 2800;
    treble.gain.value = 6.0;

    const lowCut = offlineCtx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 180;

    lastNode.connect(treble);
    treble.connect(lowCut);
    lastNode = lowCut;
  } else if (effect === 'radio') {
    // Telephone / Vintage Transceiver bandpass (350Hz - 3400Hz)
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;

    const lp = offlineCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;

    const peak = offlineCtx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1600;
    peak.gain.value = 5;

    lastNode.connect(hp);
    hp.connect(lp);
    lp.connect(peak);
    lastNode = peak;
  } else if (effect === 'robot') {
    // Metallic vocoder / ring modulation emulation
    const comb = offlineCtx.createBiquadFilter();
    comb.type = 'peaking';
    comb.frequency.value = 440;
    comb.Q.value = 12;
    comb.gain.value = 12;

    const comb2 = offlineCtx.createBiquadFilter();
    comb2.type = 'peaking';
    comb2.frequency.value = 880;
    comb2.Q.value = 10;
    comb2.gain.value = 8;

    lastNode.connect(comb);
    comb.connect(comb2);
    lastNode = comb2;
  } else if (effect === 'studio') {
    // Broadcast voice: rumble cut + air presence
    const rumble = offlineCtx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 75;

    const air = offlineCtx.createBiquadFilter();
    air.type = 'peaking';
    air.frequency.value = 3400;
    air.gain.value = 4.0;
    air.Q.value = 1.0;

    lastNode.connect(rumble);
    rumble.connect(air);
    lastNode = air;
  } else if (effect === 'whisper') {
    // Breath airy texture
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;

    const air = offlineCtx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 4500;
    air.gain.value = 7.0;

    lastNode.connect(hp);
    hp.connect(air);
    lastNode = air;
  }

  // Master compressor to prevent clipping
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 20;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  lastNode.connect(compressor);
  compressor.connect(offlineCtx.destination);

  source.start(0);
  return await offlineCtx.startRendering();
};

