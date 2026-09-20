# Contributing to DHVANI

Thanks for wanting to help. This document covers what you need to know to make a change that will be
merged quickly.

## Getting set up

```bash
git clone https://github.com/dhvani-studio/dhvani.git
cd dhvani
npm install
cp .env.example .env     # then paste your own keys
npm run dev
```

`npm run dev` starts the backend on `:8787` and the Vite dev server on `:3000`, with `/api` proxied
between them. The backend restarts on change; the frontend hot-reloads.

You need Node 20+. ffmpeg is optional — `npm install` fetches `ffmpeg-static` for you.

## Before you open a pull request

```bash
npm run verify
```

That runs the typecheck, the tests and a production build. CI runs the same thing on Node 20 and 22,
so if it passes locally it will pass there.

## The rule that governs this codebase

> **ElevenLabs is the source of truth for transcription and subtitle timestamps. Gemini is used only
> for translation. Gemini must not create or alter subtitle timing.**

A change that weakens this will not be merged, however convenient it is. Concretely:

- **Never put a timestamp in a model prompt.** Not as context, not "to help it judge pacing", not in
  a comment inside the JSON. If a model cannot see timing, it cannot corrupt it.
- **Never derive a cue boundary from generated text.** Boundaries come from
  `buildCuesFromWords`, which reads ElevenLabs word timings.
- **Translation replaces a text field.** `retextCues` is the only supported way translated text
  enters a cue. Do not build a new cue object from model output.
- **Keep `assertTimingsPreserved` in the path.** It is cheap and it is the last line of defence.

`server/lib/srt.test.js` and `server/lib/pipeline.test.js` encode these as tests, including one that
feeds the pipeline a translator returning timecode-shaped text. If you touch timing, add a test.

The one legitimate exception is `adjustSegmentsForDubbedTimeline`, which times captions for a
synthesized dub — a different recording with a different length. It is documented as such and must
not be used for the source track.

## Where things live

| Area | Path |
| --- | --- |
| Timing engine | `server/lib/srt.js` |
| Workflow orchestration | `server/lib/pipeline.js` |
| Provider integrations | `server/providers/` |
| HTTP surface | `server/routes/` |
| Frontend ↔ backend boundary | `services/apiClient.ts` |
| UI | `components/`, `App.tsx` |

`docs/ARCHITECTURE.md` explains how they fit together. Read it before a structural change.

## Adding a provider

Providers are registered by capability, so a new one touches no route and no pipeline code:

```js
// server/providers/index.js
registerProvider('transcription', 'whisper', {
  label: 'Local Whisper',
  providesWordTimestamps: true,
  isConfigured: () => true,
  transcribe: async (file, options) => ({
    text, words, cues, languageName, languageCode, duration, audioExtracted,
  }),
});
```

A transcription provider **must** return word-level timestamps, and should build its cues with
`buildCuesFromWords` so the timing guarantee carries over. If it genuinely cannot, set
`providesWordTimestamps: false` so the UI stops claiming exact timings.

A translation provider needs `translate(cues, options)` returning
`{ translations: Map<id, text>, modelUsed, translatedCount, missingIds, failedBatches }`.

## Style

Match the file you are editing. Beyond that:

- **Backend is plain ESM JavaScript**, no build step. Frontend is TypeScript.
- **Comment the "why", not the "what".** A comment explaining that a loop iterates an array is
  noise; one explaining why a float is accumulated in integer milliseconds is not.
- **Error messages name the fix.** "ElevenLabs API key is not configured. Add ELEVENLABS_API_KEY to
  your .env file and restart the server" — not "401 Unauthorized".
- **Fail without losing work.** A failure in a late stage should preserve what earlier stages
  produced. Transcription surviving a failed translation is the model to follow.
- **No new runtime dependency without a reason** you can state in the PR description.

## Pull requests

- One logical change per PR. A drive-by refactor in a bug-fix PR makes both harder to review.
- Say what you changed, why, and how you verified it. Include the failing case if it is a bug fix.
- Update `docs/` when you change behaviour, and add a `CHANGELOG.md` entry under `[Unreleased]`.
- UI changes: include a screenshot. The app has a light and a dark theme; check both.

## Reporting bugs

Open an issue with the version (shown in `/api/health`), your OS, what you did, what happened, and
what you expected. For a subtitle-timing problem, the SRT excerpt and the source file's duration are
the two most useful things you can include.

**Never paste an API key into an issue**, including a partial one. If you have leaked one, revoke it
at the provider first.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
