This folder makes DHVANI portable.

While it sits next to DHVANI.exe, everything the app saves stays here:
your API keys, settings and backend.log. Copy the whole DHVANI folder to a
USB stick or another PC and your setup goes with it.

Delete this folder and DHVANI reverts to storing that data in
%APPDATA%\DHVANI, the way an installed copy does.

Keep it out of shared drives and backups you don't control: the API keys in
settings.json are stored in plain text.
