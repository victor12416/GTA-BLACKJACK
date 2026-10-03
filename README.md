# GTA Blackjack Calculator

Mobile-first GTA Online Diamond Casino blackjack probability calculator designed for GitHub Pages.

## Current build

- Models a fresh 4-deck (208-card) shoe for every hand.
- Removes the exact visible card ranks from the shoe.
- Correctly treats the dealer hole card as hidden information while conditioning it on GTA's early-blackjack check.
- Dealer stands on soft 17.
- Exact composition-dependent Hit, Stand, and Double Down EV calculations.
- Includes Seven-Card Charlie in the recursive decision tree.
- Supports GTA splitting rules: one split, equal-value cards, double after split, continued play after split aces, and GTA's 3:2 payout for a two-card 21 created by a split.
- Split EV uses a fast four-deck composition approximation so pair calculations remain practical on a phone.
- Heavy calculations run in a Web Worker so the mobile UI stays responsive.
- Accepts optional visible cards from other players at the table.
- Screenshot/photo upload and local preview are wired into the UI.
- Automatic card recognition is intentionally not guessing yet; `card-detector.js` is isolated for calibration with real GTA screenshots.

## Math model

Hit / Stand / Double are finite-shoe, composition-dependent calculations. The engine never reveals the dealer's hidden card to its own future decision recursion. Instead, it tracks the probability distribution of the hole card implied by the visible shoe and GTA's dealer-blackjack peek.

Split is more expensive computationally. A fully joint two-hand composition tree can exceed phone-browser memory, so the site evaluates one post-split hand using the exact current four-deck composition and GTA-specific rules, then combines two copies of that payoff distribution. This is a much stronger model than an infinite-deck strategy chart, while remaining fast enough for live use. The small dependency caused by the first split hand consuming cards before the second is the remaining approximation.

See [`RULES.md`](RULES.md) for the GTA rules and evidence used by the engine.

## Still to add

1. Screenshot card-rank detection for the GTA blackjack table layout.
2. Confidence scoring and manual correction when recognition is uncertain.
3. More screenshot-layout profiles if console/PC resolutions differ.
4. Optional deeper split calculation for desktop use if it can be bounded safely.

## Run locally

No build step is required. Serve the folder with any static web server, or publish the repository with GitHub Pages.

Run engine tests with:

```bash
npm test
```
