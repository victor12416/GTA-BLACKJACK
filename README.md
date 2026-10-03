# GTA Blackjack Quick Calc

A mobile-first GTA Online Diamond Casino blackjack probability calculator designed for extremely fast **manual entry** during solo play.

## Live workflow

The live page intentionally does **not** use the camera or screenshot scanner anymore. The entire calculator fits inside one phone viewport with page scrolling disabled.

1. Tap the dealer upcard on the shared rank keypad.
2. The calculator automatically switches to **YOUR NEXT CARD**.
3. Tap your first two cards.
4. The best move appears automatically.
5. If you hit in GTA, tap the new card and the recommendation recalculates.
6. Use **UNDO** for a bad tap or **NEW HAND** to immediately start the next deal.
7. Tap the dealer or player hand panel to switch which side you are editing.

Player card chips are individually removable by tapping them.

## Probability engine

- Fresh 4-deck (208-card) shoe for every GTA hand.
- Exact visible-rank removal.
- Dealer hole card stays hidden while the model conditions it on GTA's early-blackjack check.
- Dealer stands on soft 17.
- Exact composition-dependent Hit, Stand, and Double Down EV calculations.
- Seven-Card Charlie support.
- GTA split rules: one split, equal-value cards, double after split, continued play after split aces, and GTA's 3:2 payout for a two-card 21 created by a split.
- Split EV uses the existing fast four-deck composition approximation so pair calculations remain practical on a phone.
- Heavy probability calculations run in a Web Worker so entry remains responsive.

The result panel shows the recommended move, its win/push/loss probabilities, and compact EV values for every currently legal action.

See [`RULES.md`](RULES.md) for the GTA-specific rules and evidence used by the engine.

## Scanner code

Earlier experimental OCR/camera code remains in `card-detector.js` for project history, but it is no longer imported or loaded by the live calculator.

## Run locally

No build step is required. Serve the folder with any static web server, or publish the repository with GitHub Pages.

Run tests with:

```bash
npm test
```
