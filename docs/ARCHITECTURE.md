# Architecture

How DHVANI is put together, and how the subtitle-timing guarantee is enforced.

---

## The one rule

> **ElevenLabs is the source of truth for transcription and subtitle timestamps.
> Gemini is used only for translation. Gemini must not create or alter subtitle timing.**

Everything below exists to make that rule hold even when a model misbehaves.

---

## Process layout

```
┌────────────────────────────────────────────┐
│ Browser — React 19 + Vite   (port 3000)    │
│                                            │
│  No SDK. No API key. No provider call.     │
│  Talks to /api/... and nothing else.       │
└──────────────────┬─────────────────────────┘
                   │  same-origin in production,
                   │  Vite proxy in development
┌──────────────────▼─────────────────────────┐
│ Backend — Express        (port 8787)       │
│                                            │
│  Reads ELEVENLABS_API_KEY and              │
│  GEMINI_API_KEY from .env                  │
├────────────────────────────────────────────┤
│  ElevenLabs  │  Gemini                     │
│  transcribe  │  translate                  │
│  timestamps  │  align                      │
│  TTS / STS   │  polish / SSML / TTS        │
│  cloning     │                             │
└────────────────────────────────────────────┘
```

In production `npm start` builds the frontend and the backend serves `dist/`, so there is a single
local origin and no CORS surface at all.

---

## The pipeline

`server/lib/pipeline.js`, one function: `runSubtitlePipeline`.

### Stage 1 — Transcription

`POST /api/pipeline/subtitles` receives the upload and streams it to disk (`multer` disk storage),
so a multi-hour recording never has to fit in the Node heap.

If the file is a video, `extractAudioTrack` runs ffmpeg to produce a mono 16 kHz WAV. The source file
is opened read-only and never rewritten. When ffmpeg is unavailable the original container is
uploaded instead and the run continues.

ElevenLabs Scribe is called with `timestamps_granularity=word`. The response carries:

```json
{
  "language_code": "eng",
  "text": "Time is not money.",
  "words": [
    { "text": "Time",  "start": 0.20, "end": 0.55, "type": "word" },
    { "text": " ",     "start": 0.55, "end": 0.58, "type": "spacing" },
    { "text": "is",    "start": 0.58, "end": 0.71, "type": "word" }
  ]
}
```

`filterSpokenWords` drops `spacing` and `audio_event` tokens, so neither padding nor a `(laughter)`
marker can influence a cue edge or leak into subtitle text.

### Stage 2 — Cue building

`buildCuesFromWords` walks the word list and opens a new cue on any of:

- a silence gap ≥ `gapThresholdSeconds` (0.6s)
- sentence-final punctuation once the cue is long enough to stand alone
- a speaker change (when diarization is on)
- the character, word-count or duration limit

```js
cue.startTime = cue.words[0].start                      // measured
cue.endTime   = cue.words[cue.words.length - 1].end     // measured
```

No arithmetic, no interpolation, no rounding beyond millisecond precision. A test asserts that every
cue edge is a member of the measured word-edge set.

### Stage 3 — Original SRT

`serializeSrt` writes sequential cue numbers and `HH:MM:SS,mmm` timecodes straight from the cue.

### Stage 4 — Translation

`translateCueTexts` batches cues (default 40) and sends each batch to Gemini as:

```json
{ "translations": [ { "id": "cue-1", "text": "Time is not money." } ] }
```

**There is no timing field in the request.** The model cannot shift what it never receives.

Batching also gives long-file resilience: a batch that fails is logged and skipped, the batches that
already succeeded are kept, and the merge is keyed by cue id so nothing can reorder.

### Stage 5 — Translated SRT

```js
retextCues(sourceCues, translations, 'translatedText')
// → { ...cue, translatedText: newText }
```

A spread plus one string field. `startTime`, `endTime` and `words` come across untouched. A cue the
model skipped keeps its source text, which keeps the cue count and numbering stable.

Then:

```js
assertTimingsPreserved(sourceCues, translatedCues)
```

throws if any id, start or end differs. It has never fired in practice — it is there so that if a
future refactor breaks the invariant, it fails loudly rather than silently shipping drifted
subtitles.

---

## Four independent defences

| # | Defence | Where |
| --- | --- | --- |
| 1 | Cue edges are measured word edges | `buildCuesFromWords` |
| 2 | Prompts contain no timing | `translateCueTexts`, `alignScriptToCues` |
| 3 | Translation is a text-field swap | `retextCues` |
| 4 | The result is verified against the source | `assertTimingsPreserved` |

Defence 2 is the strongest: with no timestamp in the prompt, there is nothing for the model to get
wrong. Defences 1, 3 and 4 make sure a future change cannot quietly reintroduce one.

`server/lib/pipeline.test.js` includes a translator stub that returns
`"00:00:99,000 --> 00:01:99,000 garbage"` as its translation for every cue. The exported SRT keeps
the correct timings, because timecode-shaped text is still just text.

---

## The one place that does re-time, on purpose

`adjustSegmentsForDubbedTimeline` in `services/srtService.ts` re-times cues for the **synthesized
dub**. That dub is a new recording with a different length, so the source timestamps genuinely do not
apply to it. The original ElevenLabs timings stay on the source segments and continue to drive the
source-language SRT. The export dialog labels the two clearly, and only marks an export "Exact
ElevenLabs timings" when the source track is selected.

---

## Failure handling

### Translation failures never cost transcription

The translation stage is wrapped so a failure returns the transcript, the word timestamps and the
original SRT with a `translationWarning`, rather than throwing away the run. The UI shows the warning
and offers retranslation, which goes to `/api/pipeline/retranslate` — cue text only, no re-upload,
no re-transcription.

### Retries

`requestWithRetry` retries only 429, 5xx and network faults, with exponential backoff. A 401 or a
malformed request fails immediately instead of burning three more calls against a bad key.

The Gemini client cascades through `GEMINI_TRANSLATION_MODELS` so a model that is gated for a given
key falls through to the next — except on an authentication error, which stops the cascade at once.

### Error messages

`fromProviderResponse` maps provider HTTP statuses onto messages that name the cause and the fix
("Add ELEVENLABS_API_KEY to your .env file and restart the server") rather than surfacing a status
code. The frontend's `describePipelineError` adds UI-level context on top.

---

## Streaming progress

`/api/pipeline/subtitles` responds with newline-delimited JSON:

```
{"type":"progress","stage":"transcribing","progress":0.2,"message":"Uploading audio to ElevenLabs..."}
{"type":"progress","stage":"transcribed","progress":0.55,"message":"Transcribed 42 cues in English."}
{"type":"progress","stage":"translating","progress":0.8,"message":"Translating cues 41-80 of 120..."}
{"type":"result","cues":[...],"originalSrt":"...","translatedSrt":"..."}
```

`apiStream` in `services/apiClient.ts` reads the stream and forwards each progress event to the UI.
Because a streaming response cannot change its status code after the first byte, failures are
reported as a terminal `{"type":"error"}` event and the client raises it as a `DhvaniApiError`.

---

## Credentials

- Keys are read once at startup from `.env` into `server/env.js`.
- `/api/health` reports only booleans — `elevenLabsConfigured`, `geminiConfigured` — never a key or
  a fragment of one.
- When the backend holds a key, the UI shows the sentinel `__server_managed_key__` and the settings
  field renders empty with an explanatory placeholder. The sentinel is stripped before any request.
- `x-elevenlabs-key` / `x-gemini-key` headers are accepted so a user can try a personal key from the
  UI, but `resolveKey` gives the `.env` key precedence, so an override can never become the app's
  default credential.
- `.env` is gitignored; `.env.example` carries the documented keys with empty values.

---

## Extending it

`server/providers/index.js` is a capability registry. The pipeline resolves providers by name, so
adding one touches no route and no pipeline code:

```js
registerProvider('transcription', 'whisper', {
  label: 'Local Whisper',
  providesWordTimestamps: true,
  isConfigured: () => true,
  transcribe: async (file, options) => ({
    text, words, cues, languageName, languageCode, duration, audioExtracted,
  }),
});

activeProviders.transcription = 'whisper';
```

The contract for a transcription provider is `{ text, words, cues, languageName, languageCode,
duration }`, where `cues` should come from `buildCuesFromWords` so the timing guarantee carries over.
A provider without word timestamps can be registered, but `providesWordTimestamps: false` is
reported through `/api/health` and the result's `timingSource` so the UI can stop claiming exact
timings.

A translation provider needs `translate(cues, options)` returning
`{ translations: Map<id, text>, modelUsed, translatedCount, missingIds, failedBatches }`.

A per-request `provider` field can also select a registered provider without changing the default.
