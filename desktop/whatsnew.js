/**
 * Help → What's New (desktop/whatsnew.html). One or two short, plain lines per
 * version, newest first. Add the next version's lines here before releasing;
 * versions newer than the running app are not shown.
 */
window.WHATS_NEW = [
  {
    version: '1.3.73',
    changes: [
      'Work on another project while one dubs: pressing Dub there puts it in line, and it starts on its own when the first one finishes. Each project shows only its own progress and errors.',
      'Transcribing or translating one project no longer stops or locks another.',
      'Urdu is no longer in the language lists.',
    ],
  },
  {
    version: '1.3.72',
    changes: [
      'Export subtitles no longer gets stuck on timing: it shows the seconds as it works, gives up after 90 s, and Retry starts it fresh, so no restart is needed.',
      'Only the subtitle list scrolls now; the settings and the video stay in place.',
    ],
  },
  {
    version: '1.3.71',
    changes: [
      'Voice changer: Replace the dub now works line by line, so every line keeps its place and your Edit timing edits. Each speaker can get their own voice.',
      'When a translation misses a few lines, the notice now has a button that translates just those lines, leaving every other line and the dub as they are.',
    ],
  },
  {
    version: '1.3.70',
    changes: [
      'Shorter wording suggestions are measured in syllables, so they really fit, and Suggest 3 in the Sync report offers three at once, best fit first.',
      'Chunk sync closes up pauses the original never made, even inside a line, and Close up in Edit timing works on picked lines or on all lines.',
      'Pause detection and cue starts catch soft sounds (a quiet "s" or "h") better, with an Advanced gate section in the pause settings.',
    ],
  },
  {
    version: '1.3.69',
    changes: [
      'A dub that stops part way (DHVANI closed, crashed, or a request failed) now picks up where it left off: Resume dub voices only the lines it never got, so you do not pay for the rest twice.',
      'If a project cannot be saved to this computer, a notice now says so, with Save again, instead of losing the latest changes silently.',
      'New Audio quality setting on the Dub step: WAV 48 kHz by default, or MP3 192 / 128. If your ElevenLabs plan refuses a format, the next one down is used and a note says why.',
    ],
  },
  {
    version: '1.3.68',
    changes: [
      'The Dub step no longer freezes for several seconds when it opens or when you zoom the Rythmo view on a long script.',
      'Editing timing stays light on memory: renders you have already replaced are no longer kept, and dragging lines is smoother with many lines on screen.',
      'New translation style, Sadhguru 3-Step (Full Meaning): long lines are shortened by word choice and by rewording neighbouring lines together, not by cutting detail.',
    ],
  },
  {
    version: '1.3.67',
    changes: [
      'When ElevenLabs splits one person into two speakers, Review now notices: it compares the voices and offers to merge speakers that sound alike and never talk over each other, with Hear first.',
      'Cues that sound like another speaker than their label are flagged, with Relabel by voice to fix them all. Tick cues (Shift-click for a range) and set them to one speaker in one go.',
      'In the Script view each passage has its own play button and stops at its end, and a white bar glides along the playing line in the original and the dub.',
    ],
  },
  {
    version: '1.3.66',
    changes: [
      'Editing a long dub no longer runs DHVANI out of memory: edits render one at a time, and renders you have already replaced are skipped. This fixes "Could not reach the local DHVANI backend" after many quick edits.',
    ],
  },
  {
    version: '1.3.65',
    changes: [
      'The review video now floats over the Dub page, also while you edit timing: drag it by its title, resize it from any edge or corner, and it settles into a corner when you drop it near one. Reels and wide videos both fit, with black bars.',
      'The floating video has its own play, line jumps and Listen to. The ✕ hides it, and Show video in the player brings it back.',
    ],
  },
  {
    version: '1.3.64',
    changes: [
      'Watch your video while you review the dub: Add video in the Dub player shows a silent video that follows playback. It is not saved with the project or used in the render.',
      'Your projects and Balance now open in the middle of the screen, like Tools and settings. Click outside or press Esc to close them.',
    ],
  },
  {
    version: '1.3.63',
    changes: [
      'Sync voices no line again on its own: Pick the best of 3 takes and Read it faster start off. Turn either to Ask or Auto under When a line still runs long.',
      'Picking a preset no longer turns wording suggestions on. They stay off until you turn them on.',
    ],
  },
  {
    version: '1.3.62',
    changes: [
      'Phonetic typing works in the Script view too: type Roman letters and get the script as you go, pick another spelling with 1 to 5, or press Esc to keep a word in English. Ctrl G turns it on or off.',
      'The mini player comes up as soon as the play button starts to scroll out of sight, and Esc in a Script cell now really undoes your changes.',
    ],
  },
  {
    version: '1.3.61',
    changes: [
      'Review has a Script view: each passage is one row, the original beside the dub text, which you edit like a table cell, one line per cue. It replaces the Document view.',
      'Sync presets now go by how long the dub runs against the original, and what is on screen. After a sync, Dub suggests the preset that suits the dub.',
      'A line that is still too long can get the best of 3 takes or a calm, faster read. Review lets you compare old and new, or Sync uses the new one at once.',
    ],
  },
  {
    version: '1.3.60',
    changes: [
      'The script follows the synced dub: a line you remove or mute in Edit timing is left out, and each line keeps its time in the dub. Choose Full script to keep every line.',
      'In Export subtitles, press Edit subtitles to change the words or times of any subtitle by hand, or remove one. Your edits are kept, and the subtitles also save as a script.',
      'In Edit timing, press Shift M to put a marker with a note at the playhead, for a spot to check again. Markers never change the dub.',
    ],
  },
  {
    version: '1.3.59',
    changes: [
      'Tools and settings opens in the middle of the screen: point at any tool or setting to see what it is set to now, then open it. Search it, use the arrow keys, or press Ctrl K from anywhere.',
      'Sync settings fills the screen with every section in view, a search, a small picture of what each setting does, and a reset for each setting. It also opens from Tools and settings on any step.',
    ],
  },
  {
    version: '1.3.58',
    changes: [
      'Sync now places each line in chunks, split where the voice goes quiet, and puts every chunk on the original\'s words. Pauses shrink between words first and at sentence ends last, and no word is ever cut.',
      'A line that is still too long is voiced again a little faster, up to 1.15×. Eleven v3 and v4 voices ignore speed, so Review says to shorten those lines instead.',
      'In Edit timing, pick lines and press Q to take out long silences: see in red what will be cut, listen, then apply or undo.',
    ],
  },
  {
    version: '1.3.57',
    changes: ['DHVANI now notices on its own when the window freezes and notes in its log what it was busy with, so the freeze can be found and fixed.'],
  },
  {
    version: '1.3.56',
    changes: [
      'A new Sadhguru translation style keeps every thought, its pauses and its spoken length, in every language.',
      'If the window stops responding, DHVANI now notes in its log what it was busy with, so a freeze can be traced and fixed.',
    ],
  },
  {
    version: '1.3.55',
    changes: [
      'Review reads in passages. Cues and Document break the script wherever the original speaker pauses (0.8, 1.2 or 2 seconds), and each passage shows how many lines are too fast, tight or end early.',
      'Document marks lines that need work right in the text, with the speed or the gap beside them, and can save the dub script as a .txt file.',
      'Review now has three views: Cues, Document and QA. Cards, Spotlight and Script are gone, because Cues and Document do everything they did.',
    ],
  },
  {
    version: '1.3.54',
    changes: [
      'In Edit timing you can drag a line past the lines next to it and drop it into any empty gap it fits. The gap shows green when it fits and red when it is too small.',
    ],
  },
  {
    version: '1.3.53',
    changes: [
      'Retaking a line is easier. In Edit timing, pick a line and press T: its takes open in a window you can drag anywhere, and clicking the timeline does not close it.',
      'Use a take and it goes straight into the timeline. Pick another line while the window is open and it follows.',
    ],
  },
  {
    version: '1.3.52',
    changes: [
      'Edit timing now shows every line as a solid coloured clip with a clean, sharp waveform, in the original and in the dub.',
      'The players are back to the familiar dense bars, and they hold still while you scroll.',
    ],
  },
  {
    version: '1.3.51',
    changes: [
      'Sharper waveforms. Each bar now shows how loud the voice really is as a solid core inside its peak, and the bars hold still while you scroll the timeline.',
    ],
  },
  {
    version: '1.3.50',
    changes: [
      'Pasting a script into Custom Script no longer starts matching on its own. Paste, choose how to split it, then press the button to match it to the English.',
    ],
  },
  {
    version: '1.3.49',
    changes: [
      'DHVANI now starts even when another program on the computer is already using its usual connection port. It quietly picks a free one, and your saved projects and settings stay as they were.',
    ],
  },
  {
    version: '1.3.48',
    changes: [
      'DHVANI now always uses its dark look. The Theme option has been removed from the menu.',
    ],
  },
  {
    version: '1.3.47',
    changes: [
      'Sync now pauses only where the original speaker pauses. A pause the voice adds where the speaker talked straight on is cut down to a short gap, so the dub no longer runs longer than the original. Turn it off in Sync settings → Pauses inside a line. Sync again to apply it to an existing dub.',
      'Review and the Dub step point out commas and full stops in a line where the original speaker doesn’t pause, since the voice tends to stop there.',
    ],
  },
  {
    version: '1.3.46',
    changes: [
      'Continue to dub on the Review page now stays at the bottom of the window, so you can always see it without scrolling down.',
    ],
  },
  {
    version: '1.3.45',
    changes: [
      'Sync settings open in a window of their own from the Dub step, with every setting in sections you can jump between. The Dub step keeps a short summary of what the sync will use, so the dub, subtitles and files fit without scrolling.',
    ],
  },
  {
    version: '1.3.44',
    changes: [
      'Click a line in Edit timing to edit its words and retake it right there. Suggest wording offers new wordings with pauses placed where the meaning wants them, sized to the line’s time, and you see and can change every pause.',
      'Locked lines can be retaken without unlocking them, and they stay locked. Lines too long or short in the Dub step’s estimate get their suggestions and your own edit right there, without going to Review.',
    ],
  },
  {
    version: '1.3.43',
    changes: [
      'Long dubs no longer stop with “Too many requests to the local DHVANI backend”. Checking a dub’s progress no longer counts toward that limit, so an hour-long video dubs through.',
    ],
  },
  {
    version: '1.3.42',
    changes: [
      'If another program is using the port DHVANI needs, DHVANI now says which program it is and can close it for you, instead of waiting 30 seconds and failing. A DHVANI engine left running from before is closed on its own.',
    ],
  },
  {
    version: '1.3.41',
    changes: [
      'With several speakers, Edit timing gives each speaker their own lane, with their voice and speed, a level for the dub, and mute and solo for listening. Speakers’ lines can overlap, as in the original.',
      'Each speaker’s own voice is measured too, and translation and Review size each line for the voice that says it. You can pick each speaker’s voice on Source & voice, before translating.',
    ],
  },
  {
    version: '1.3.40',
    changes: [
      'When you pick a voice, it reads a short sample once to measure how fast it speaks in your dub language. Review’s line fit and syllable hints use that speed before the first sync, and translation can size each line for the voice (a checkbox turns this off).',
      'The language list is shorter: Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri, Sanskrit, Santali, Sindhi and Urdu are no longer offered.',
    ],
  },
  {
    version: '1.3.39',
    changes: [
      'Review shows each line’s syllables next to its characters, and the dub line says how many syllables to take out to fit its time, or how many more it has room for. It updates as you type.',
    ],
  },
  {
    version: '1.3.38',
    changes: [
      'When a translated script is matched to the lines by meaning, a sentence’s last word or two (like “है।”) now stays on the line it ends instead of starting the next one. Line timings don’t change.',
    ],
  },
  {
    version: '1.3.37',
    changes: [
      'Sync settings are kept with each project and can be saved as named presets. Strict timing and Protect long pauses never fail a sync: a line that can’t meet its limit is placed as early as it can go and flagged.',
      'Breaths can be softened instead of removed, and an optional check measures each line’s spoken words against the original’s timing. The check never changes the dub.',
      'Locked lines stay where you put them unless the lines before need the room; then they move only that far and are flagged. A locked line can be retaken.',
    ],
  },
  {
    version: '1.3.36',
    changes: [
      'Retake a synced line instantly: hear three new takes, compare their timing and choose which one goes in the dub. Return to another take while working on the same sync.',
      'In Edit timing, Select range picks words directly from the dub waveform using forced alignment. Retake the whole line or only the selected phrase.',
      'Choose Same, A bit faster, A bit slower, Calmer or More energy. Retake buttons show estimated character costs; locked or changed lines are protected.',
    ],
  },
  {
    version: '1.3.35',
    changes: [
      'Sync has one Export subtitles section, with the .srt download inside it.',
      'Voice Settings shows when a long dub’s stability was steadied, and a new Auto-tune stability switch turns that off.',
      'The text-to-speech studio uses the dub’s voice settings by default (Same as the dub).',
      'A dub rebuilt from its decoded copy is now the same audio, bit for bit. Review plays the original.',
    ],
  },
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
