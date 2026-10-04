# GTA Blackjack Manual Calculator

A mobile-first GTA Online Diamond Casino blackjack probability calculator designed for fast manual use during solo play.

## Live workflow

1. Pick the dealer's showing card from the permanent **DEALER CARD** grid.
2. Add your cards from the permanent **YOUR HAND** keypad.
3. The best move appears automatically.
4. If you HIT, tap the new card on the same keypad and the recommendation recalculates.
5. **UNDO** removes your newest card.
6. **CLEAR HAND** keeps the dealer card but clears your cards.
7. **NEW HAND** clears both dealer and player cards.

The calculator stays inside one phone viewport with page scrolling disabled.

## Reload Mode

The header includes a **RELOAD MODE** toggle for the user's GTA save/reload play style.

- When Reload Mode is OFF, the normal finite-shoe EV recommendation is shown.
- When Reload Mode is ON and **Double Down is legally available**, the displayed recommendation is forced to **DOUBLE**.
- If Double Down is not legally available anymore, such as after taking a hit, the calculator falls back to the normal best legal move.
- The probability line marks the loss outcome as the one the user intends to discard by reloading.

Reload Mode changes only the displayed action priority. It does not modify the blackjack probability engine or pretend Double is legal when GTA rules do not allow it.

## Probability engine

- Fresh 4-deck (208-card) shoe for every GTA hand.
- Exact visible-rank removal.
- Dealer hole card stays hidden while the model conditions it on GTA's early-blackjack check.
- Dealer stands on soft 17.
- Exact composition-dependent Hit, Stand, and Double Down EV calculations.
- Seven-Card Charlie support.
- GTA split rules: one split, equal-value cards, double after split, continued play after split aces, and GTA's 3:2 payout for a two-card 21 created by a split.
- Split EV uses the existing fast four-deck composition approximation so pair calculations remain practical on a phone.
- Heavy probability calculations run in a Web Worker so card entry remains responsive.

See [`RULES.md`](RULES.md) for the GTA-specific rules and evidence used by the engine.

## Scanner code

Earlier experimental camera/OCR code remains in `card-detector.js` for project history, but the live calculator does not import or load it.

## Run locally

No build step is required. Serve the folder with any static web server, or publish the repository with GitHub Pages.

Run tests with:

```bash
npm test
```
