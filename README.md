# GTA Blackjack Calculator

Mobile-first GTA Online Diamond Casino blackjack probability calculator designed for GitHub Pages.

## Current build

- Models a fresh 4-deck (208-card) shoe for every hand.
- Removes the exact visible card ranks from the shoe.
- Conditions the dealer hole card on GTA's early-blackjack check when the decision screen is active.
- Dealer stands on soft 17.
- Supports Hit, Stand, and Double Down EV calculations.
- Includes Seven-Card Charlie in the recursive player decision tree.
- Accepts optional visible cards from other players at the table.
- Screenshot/photo upload and local preview are wired into the UI.
- Automatic card recognition is intentionally not guessing yet; `card-detector.js` is isolated for calibration with real GTA screenshots.

## Important math note

This engine uses composition-dependent finite-shoe calculations, not only a normal total-dependent basic-strategy chart. That means two hands with the same total can occasionally produce different decisions because the exact ranks removed from the four-deck shoe change the probabilities.

## Still to add

1. Exact split EV, including double-after-split and the one-split GTA limit.
2. Screenshot card-rank detection for the GTA blackjack table layout.
3. Confidence scoring and manual correction when recognition is uncertain.
4. More regression tests against known GTA/blackjack edge cases.

## Run locally

No build step is required. Serve the folder with any static web server, or publish the repository with GitHub Pages.

Run engine tests with:

```bash
npm test
```
