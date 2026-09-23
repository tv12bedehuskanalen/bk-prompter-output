# OSC over UDP

Default listener: all IPv4 interfaces, UDP **7891**. Change this in System → OSC. Web and OSC ports are independent. OSC follows the same ownership lock and playback engine as browser controls. Choose “OSC · Automatisering” in the client menu to lock to automation.

| Address | Argument | Effect |
| --- | --- | --- |
| `/prompter/load` | string OSC ID, e.g. `intro` | Load that script in the current program; pause and reset |
| `/prompter/start` or `/prompter/play` | none | Start |
| `/prompter/pause` or `/prompter/stop` | none | Pause in place |
| `/prompter/toggle` | none | Toggle play/pause |
| `/prompter/speed` | float/integer, -500 to 500 | Logical pixels per second; negative is reverse |
| `/prompter/seek` | float/integer, >= 0 | Absolute logical text position |
| `/prompter/reset` | none | Pause at the beginning |
| `/prompter/next` | none | Load next script, paused at start |
| `/prompter/previous` | none | Load previous script, paused at start |
| `/prompter/nextChapter` or `/prompter/chapter` | none | Jump to next heading, preserving play/pause |
| `/prompter/hold` | none | Temporarily pause; repeat every <= 1 second while held |
| `/prompter/release` | none | Release the OSC hold |
| `/prompter/state` | none | Reply with transport JSON |

Replies are sent to the originating address and UDP source port:

- `/prompter/ok` + string action for accepted commands.
- `/prompter/error` + string description for invalid commands, missing IDs or ownership rejection.
- `/prompter/state` + JSON string with `position`, `speed`, `playing`, `holding`, `at`.

Open a web interface first so the local renderer can report canonical chapter/end positions. Normal playback works without a controller, but chapter/end detection requires the layout report. All OSC sources currently share the single “OSC” control identity and hold lease. UDP is not a guaranteed-delivery protocol; resend state-setting commands when appropriate. Commands in OSC bundles are processed by the OSC library; future-timetag show scheduling is not a supported contract in v0.1.

Create the same `intro` ID in different programs to reuse one automation button. It will always address the script in the **currently loaded program**, never a matching script elsewhere.

A Companion module can later use this protocol. No Companion module is included yet.
