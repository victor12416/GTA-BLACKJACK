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
- Heavy probability calculations run in a Web Worker so the mobile UI stays responsive.
- Live UI assumes solo blackjack play: only the dealer upcard and the user's cards are scanned/entered.
- Screenshot/photo upload now includes an experimental in-browser card reader.
- The reader finds likely card shapes, OCRs the rank corners, overlays what it detected, and automatically fills the dealer/player ranks when confidence is sufficient.
- Every auto-read card remains manually editable. The detector deliberately falls back to manual entry instead of silently trusting weak OCR.
- Screenshot pixels stay in the browser; the first scan downloads the Tesseract.js OCR engine and English recognition data.

## Math model

Hit / Stand / Double are finite-shoe, composition-dependent calculations. The engine never reveals the dealer's hidden card to its own future decision recursion. Instead, it tracks the probability distribution of the hole card implied by the visible shoe and GTA's dealer-blackjack peek.

Split is more expensive computationally. A fully joint two-hand composition tree can exceed phone-browser memory, so the site evaluates one post-split hand using the exact current four-deck composition and GTA-specific rules, then combines two copies of that payoff distribution. This is a much stronger model than an infinite-deck strategy chart, while remaining fast enough for live use. The small dependency caused by the first split hand consuming cards before the second is the remaining approximation.

See [`RULES.md`](RULES.md) for the GTA rules and evidence used by the engine.

## Screenshot reader status

The screenshot reader is **experimental** until it is calibrated against more real screenshots from the exact GTA view/resolution you use. The live workflow assumes the user is playing alone, so side-seat cards are intentionally ignored. Its current pipeline is:

1. Downscale the screenshot for fast analysis.
2. Find bright, neutral connected components that resemble GTA playing cards.
3. Restrict recognition to GTA's dealer and solo-player hand zones; ignore side-seat players and unrelated table graphics.
4. Crop each card's upper-left rank area.
5. Run a restricted OCR pass for `A 2 3 4 5 6 7 8 9 10 J Q K`.
6. Convert J/Q/K to the engine's ten-value category.
7. Require a minimum OCR confidence, show an overlay, and keep the detected ranks editable.

The manual calculator remains the reliability fallback while the scanner is being calibrated.

## Still to add

1. Calibrate detector geometry and OCR thresholds with real screenshots from the user's GTA setup.
2. Add alternate screenshot-layout profiles if first-person/third-person or console/PC framing differs.
3. Improve confidence scoring using card-position consistency and repeated OCR preprocessing.
4. Optionally add a deeper split calculation for desktop use if it can be bounded safely.

## Run locally

No build step is required. Serve the folder with any static web server, or publish the repository with GitHub Pages.

Run engine tests with:

```bash
npm test
```
