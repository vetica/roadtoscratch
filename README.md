# Road to Scratch

A phone web app for planning golf practice and logging rounds, built for one golfer's push from an 11 index toward scratch.

- **Today**: the day's practice blocks with drills, timers and scores, plus the Fitbod body slot for that day.
- **Week**: the week's plan and how practice time is split across tee, approach, short game and putting.
- **Log**: round stats (fairways and miss side, GIR, putts, up-and-downs, penalties, poor contact) and handicap index updates copied from GHIN.
- **Progress**: index vs goal line, estimated strokes lost to a scratch golfer by area, stat trends, practice minutes, drill scores.
- **Setup**: usual week, goal, backup export and import.

Logged rounds shift the practice split toward the areas losing the most strokes. Data stays in the browser's localStorage on the phone; export a backup from Setup.

Plain HTML, CSS and JavaScript with no build step. Served by GitHub Pages; works offline via a service worker.
