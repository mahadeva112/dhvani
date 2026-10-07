import { elevenLabsMultipart } from './client.js';

/**
 * ElevenLabs forced alignment: where each word of `text` is said in the audio
 * `buffer`. Returns `{ words: [{ text, start, end }], loss }`, times in seconds.
 */
export const forceAlign = async ({ buffer, contentType = 'audio/wav', fileName = 'dub.wav', text }, { apiKey, signal } = {}) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), fileName);
  form.append('text', text);
  const response = await elevenLabsMultipart('/forced-alignment', form, { apiKey, signal });
  const data = await response.json();
  return { words: Array.isArray(data?.words) ? data.words : [], loss: data?.loss };
};
