# Workout Program Template

## New Athlete Setup

1. **Copy this folder** to `projects/workout-{athletename}/`
2. **Edit `app.js`** — top config block:
   - `firebaseConfig` — your Firebase project credentials
   - `ATHLETE_DOC` — unique name (e.g. `'john-doe'`)
   - `PIN_CODE` — athlete's editing PIN
   - `weeklyTargetMultipliers` — per-section weekly goals
3. **Edit `index.html`** — search for `EDIT` comments:
   - Hero section (name, photo, school, tagline)
   - Nav tabs (add/remove sections)
   - Exercise cards (build from exercise-library.json)
   - Footer text
   - Stats streak label
4. **Add images** to `projects/assets-images/`
5. **Create a new GitHub repo** and push
6. **Deploy** via GitHub Pages

## Exercise Card Template

```html
<div class="exercise-card" data-id="PREFIX-ID">
  <div class="exercise-check">
    <input type="checkbox" id="PREFIX-ID-check">
    <label for="PREFIX-ID-check" class="checkmark"></label>
  </div>
  <div class="exercise-info">
    <h4>Exercise Name</h4>
    <p class="exercise-details">Sets &middot; Reps &middot; Instructions</p>
    <p class="exercise-cue">Cue: Coaching cues here.</p>
    <a href="VIDEO_URL" class="video-link" target="_blank" rel="noopener noreferrer">&#9654; Watch video</a>
  </div>
  <button class="exercise-note-btn" title="Add note">&#128221;</button>
</div>
```

## ID Prefixes (for stats grouping)

| Prefix | Section | sectionMap key |
|--------|---------|----------------|
| `b3-`  | The Big 3 | `b3` |
| `mob-` | Mobility | `mob` |
| `ac-`  | Arm Care | `ac` |
| `rp-`  | Rehab/Prehab | `rp` |

To add new sections, update `getSectionKey()` and `sectionMap` in app.js.

## Shared Resources

- `projects/exercise-library.json` — master exercise database (shared across all athletes)
- `projects/assets-images/` — shared image assets
- `styles.css` — identical across all athletes (copy from template)
