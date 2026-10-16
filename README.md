# Study Timer

A simple, calm focus timer for studying. It runs in the browser, works offline once loaded, and keeps your data on your own device.

**Open it:** https://goodakag.github.io/study-timer/

## What it does

- **Just the timer.** Pick Focus, Short Break or Long Break, drag the dial, press Start.
- **Long study blocks.** Drag past a full circle (up to 3 hours). Blocks over an hour are split into equal stretches with short breaks between them and a long break at the end. For example, 1h 30m becomes 45 min focus, 5 min break, 45 min focus, then a long break.
- **Breathe first.** An optional few calm breaths before each session. You can skip it.
- **Focus screen.** Only the time and a pause button. Other controls appear in a bar at the bottom when you move the mouse.
- **Breaks.** A bright, calm screen. The break colour can be changed in Settings.
- **Today, notes, calendar, insights and journal** are in the menu in the top-right corner.
- Keyboard shortcuts: press `?`.

## Develop

```bash
npm install
npm run dev
```

`npm run build` writes the static site to `dist/`. Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

Plain JavaScript modules and CSS, built with [Vite](https://vitejs.dev). No runtime dependencies.

## Credits

Inspired by [Session](https://www.stayinsession.com/) and [Pomofocus](https://pomofocus.io/). This is an independent project and is not affiliated with either.

## License

[MIT](LICENSE)
