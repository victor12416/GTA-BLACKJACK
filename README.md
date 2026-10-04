# GTA Blackjack Manual Calculator

A mobile-first GTA Online Diamond Casino blackjack probability calculator designed for fast manual use during solo play.

## Live workflow

1. Enter your cards first from the permanent **YOUR HAND** keypad.
2. Enter the dealer's showing card from the **DEALER CARD** grid once GTA reveals it.
3. The best move appears automatically as soon as both your hand and the dealer upcard are present.
4. If you HIT, tap the new card on the same player keypad and the recommendation recalculates.
5. **UNDO** removes your newest card.
6. **CLEAR HAND** keeps the dealer card but clears your cards.
7. **NEW HAND** clears both dealer and player cards.
8. When the first two cards are a pair, **SPLIT HANDS** appears. Tap it after you actually split in GTA.
9. The app creates **HAND 1** and **HAND 2** tabs. Tap whichever hand GTA is currently dealing to, then keep entering that hand's cards with the same player keypad.
10. Each split hand gets its own recommendation while the dealer upcard stays shared.

The calculator stays inside one phone viewport with page scrolling disabled. During split play, visible cards from the other split hand are also removed from the finite shoe, and re-splitting is disabled to match the modeled GTA rules.

## Reload Mode

The header includes a **RELOAD MODE** toggle for the user's GTA save/reload play style.

- When Reload Mode is OFF, the normal finite-shoe EV recommendation is shown.
- When Reload Mode is ON, the calculator still shows the normal mathematically best legal move.
- If that move is **DOUBLE**, the user doubles and reloads if the attempt loses.
- Reload Mode never forces a bad Double just because Double Down is technically available.
- The probability line marks the loss outcome as the one the user intends to discard by reloading.

Reload Mode changes how the loss outcome is treated by the player, not the underlying blackjack recommendation.

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
