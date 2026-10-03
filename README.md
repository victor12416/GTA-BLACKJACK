# GTA Blackjack Manual Calculator

A mobile-first GTA Online Diamond Casino blackjack probability calculator designed for fast manual use during solo play.

## Live workflow

The live page uses two permanent manual controls:

1. Pick the dealer's showing card from the **DEALER SHOWING** rank grid.
2. Add your two cards from the separate **ADD YOUR CARD** keypad.
3. The best move appears automatically.
4. If GTA tells you to HIT and you receive another card, tap that card on the same player keypad.
5. Keep adding every new hit card to your hand. The recommendation recalculates after each one.
6. **UNDO LAST CARD** removes only your newest player card.
7. **CLEAR YOUR HAND** keeps the dealer card but clears your cards.
8. **NEW HAND** clears both dealer and player cards for the next deal.
9. Any player card chip can be tapped to remove that specific card.

The calculator is forced into one phone viewport with page scrolling disabled.

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
