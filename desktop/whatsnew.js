/**
 * Help → What's New (desktop/whatsnew.html). One or two short, plain lines per
 * version, newest first. Add the next version's lines here before releasing;
 * versions newer than the running app are not shown.
 */
window.WHATS_NEW = [
  {
    version: '1.3.34',
    changes: [
      'Subtitles are cut where each phrase ends and appear exactly when the words start. Subtitles for the dub are timed to the dub’s own words.',
      'Retake several lines of a synced dub at once, from the Sync report.',
      'Expression has a new Off setting, now the default, and Neutral, Natural and Expressive also work with Cartesia Sonic 3 voices.',
    ],
  },
  {
    version: '1.3.33',
    changes: [
      'Edit timing: pick several lines (Ctrl + A for the whole dub) and set one Speed for all of them. The voice keeps its pitch, and each line still starts where it did.',
    ],
  },
  {
    version: '1.3.32',
    changes: [
      'Dub has a new Expression setting: Neutral (calm and steady in the speaker’s own voice, the new default), Natural (follows how the original speaker spoke) or Expressive (adds emotion from the script).',
      'Natural no longer adds dramatic pauses or playful, emphatic tags.',
    ],
  },
  {
    version: '1.3.31',
    changes: [
      'Ask for a line’s wordings as often as you like: after you use one, Suggest again offers new ones, and Undo still goes back to the line as it was. Each suggestion shows what it says in English.',
      'A line that would lose more than a third of its words to fit is no longer shortened for you: give it more time, or join it with the line beside it.',
      'Retake voices the line three times and keeps the take that fits best. Suggestions also follow the wordings you chose before in the project.',
    ],
  },
  {
    version: '1.3.30',
    changes: [
      'After Sync, Show all lines lists every line with Listen and Retake, so you can retake any line, not only the flagged ones.',
      'Splitting a line in Review now counts as one changed line, not two.',
    ],
  },
  {
    version: '1.3.29',
    changes: [
      'In Review, any line can get other wordings: hover a line that fits and click Suggest other wordings. Suggestions keep names, numbers and glossary terms exactly, and read the lines around them.',
      'Export subtitles has a player: play the original, the dub or the synced dub and watch each subtitle as it is said; click one to play from there.',
      'Splitting, joining or moving a cut in Review now marks those lines for Sync again; a retaken line keeps its new take after a restart.',
    ],
  },
  {
    version: '1.3.28',
    changes: [
      'Dub and Sync are now one step: Dub voices your script and syncs it to the original in one go.',
      'Fill a gap in the dub with the original voice: in Edit timing, drag across the Original lane, then drag it down onto the dub (or Ctrl + C, Ctrl + V at the playhead).',
      'Scrolling up or down over Edit timing moves the timeline when zoomed in.',
    ],
  },
  {
    version: '1.3.27',
    changes: [
      'Edit timing plays your edits live: move, trim, fade or turn a line up while it plays and you hear it at once, without the player stopping.',
      'Pick several lines with Ctrl + click, a drag across empty lane or Ctrl + A, then move them, or set gain, fades and mute, all together.',
    ],
  },
  {
    version: '1.3.26',
    changes: ['The video panel in Sync is removed; the Sync player is back to the original and the dub.'],
  },
  {
    version: '1.3.24',
    changes: [
      'Sync now cuts each line out of your Final dub, so the synced dub sounds exactly like the dub; only lines you changed are voiced again.',
      'Lines Sync does voice again keep Enhance emotion and Match source audio.',
    ],
  },
  {
    version: '1.3.23',
    changes: ['Match source audio, under Enhance emotion: the dub is tagged from how the original speaker actually spoke, with no added drama.'],
  },
  {
    version: '1.3.22',
    changes: ['Match the original pace is gone from Sync settings: Eleven v3 and v4 pace themselves, so it never changed a line.'],
  },
  {
    version: '1.3.21',
    changes: [
      'The status pill now reads Online; click it to see what ElevenLabs, Cartesia and your LLM gateway have left.',
      'The voice list opens full instead of filling in after a few seconds.',
    ],
  },
  {
    version: '1.3.20',
    changes: ['Fit to this video in Sync settings: measures the original’s pauses and suggests the gaps, nothing changes until you apply.'],
  },
  {
    version: '1.3.19',
    changes: [
      'What’s New in the Help menu: every version’s changes, inside the app.',
      'Updates never open a web page; portable copies download the new version inside the app.',
    ],
  },
  {
    version: '1.3.18',
    changes: [
      'Phonetic typing and copy in the Document view.',
      'Sync can match the original speaker’s pace (off by default, in Sync settings).',
      'A quieter Review panel.',
    ],
  },
  { version: '1.3.17', changes: ['Even out loudness is now on by default.'] },
  { version: '1.3.16', changes: ['Drag a cut on the Review waveform to move it.'] },
  { version: '1.3.15', changes: ['Split and join cues by hand on the Review step.'] },
  { version: '1.3.14', changes: ['Timeline scrollbar sits under the lanes.', 'About DHVANI in the app’s colours.'] },
  { version: '1.3.13', changes: ['One Export subtitles button on Sync; it remembers language and timing.'] },
  { version: '1.3.12', changes: ['Take a script to another computer; each line goes back to its time.'] },
  { version: '1.3.11', changes: ['An Expert estimate in the Sync preview, beside the Quick one.'] },
  { version: '1.3.10', changes: ['Three suggested wordings for a line, read in context.'] },
  { version: '1.3.9', changes: ['Shows the dub’s real drift.', 'Each track has its own listening level.'] },
  { version: '1.3.8', changes: ['A clearer update window.'] },
  { version: '1.3.7', changes: ['Breaths are removed from synced dubs.'] },
  { version: '1.3.6', changes: ['Lines the voice cuts off mid-word are retaken.', 'Sentences stay whole in Sync.'] },
  { version: '1.3.5', changes: ['A loading screen while DHVANI starts.'] },
  { version: '1.3.4', changes: ['About DHVANI in the Help menu.'] },
  { version: '1.3.3', changes: ['Update window matches the app; no stray console window.'] },
  { version: '1.3.2', changes: ['Translation starts on Natural Conversational.', 'A simpler script popup.'] },
  { version: '1.3.1', changes: ['An “Updating DHVANI” window while an update installs.'] },
  { version: '1.3.0', changes: ['Edit timing.', 'Type the transcript by hand, or cancel transcription.', 'Step locks.'] },
  { version: '1.2.0', changes: ['Every dub is kept as a project until you delete it.'] },
  { version: '1.1.4', changes: ['Start-error dots are coloured by line.'] },
  { version: '1.1.3', changes: ['The Sync player is coloured by line.'] },
  { version: '1.1.2', changes: ['Each line has one colour; waveforms are drawn over the line bars.'] },
  { version: '1.1.1', changes: ['Sync timelines open on the whole track, with zoom for detail.'] },
  { version: '1.1.0', changes: ['Multi-speaker dubbing.', 'The synced dub is kept as its own file.'] },
  { version: '1.0.8', changes: ['Play the picked track from the Sync players.'] },
  { version: '1.0.7', changes: ['Progress while an update installs, and faster installs.'] },
  { version: '1.0.6', changes: ['Natural sync keeps some of the pause after a long line.'] },
  { version: '1.0.5', changes: ['Playheads stay on the audio.', 'Shows how synced lines landed.'] },
  { version: '1.0.4', changes: ['Sync suggestions start off.', 'Each new version is announced once.'] },
  { version: '1.0.3', changes: ['Light mode panels fixed.', 'Shorter or fuller wording always comes back when asked.'] },
  { version: '1.0.2', changes: ['Suggest shorter and fuller lines on the Review step.'] },
  { version: '1.0.1', changes: ['Works through office proxies and certificates.', 'Synced lines get room to breathe.'] },
];
