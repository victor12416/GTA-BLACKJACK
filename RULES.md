# GTA Online Blackjack Rules Used by the Calculator

This project targets blackjack in GTA Online's Diamond Casino, not a generic casino blackjack table.

## Modeled rules

| Rule | Engine setting | Evidence level |
| --- | --- | --- |
| Shoe | 4 standard 52-card decks (208 cards) | Strong |
| Shuffle | Fresh shuffle at the beginning of every hand | Strong |
| Dealer | Stands on all 17s, including soft 17 | Strong |
| Blackjack | Pays 3:2 | Strong |
| Insurance | Not offered | Strong |
| Surrender | Not offered | Strong |
| Seven-Card Charlie | Seven cards without busting automatically wins | Strong |
| Double | Any initial two-card hand; exactly one additional card | Strong |
| Split | First two cards of equal value; one split only | Strong |
| Double after split | Allowed on both split hands | Strong |
| Split-created two-card 21 | Treated by GTA as blackjack and paid 3:2 | Community-tested GTA-specific behavior |
| Play after splitting aces | Allowed when the new hand is not already blackjack | Community-tested GTA-specific behavior |
| Re-split | Not allowed | Strong |

## Primary references

- GTA.com.ua rules summary: https://gta.com.ua/en/faq/gta-online/291
- GameHaunt GTA Online blackjack rules: https://gamehaunt.com/how-to-play-blackjack-in-gta-online/
- FiveM recreation based on decompiled GTA scripts / in-game help strings: https://github.com/rubbertoe98/DiamondBlackjack
- GTA-specific community test documenting split Ace + 10 being paid immediately as blackjack and continued play on the other split Ace hand: https://www.reddit.com/r/blackjack/comments/ci0pks/

## Notes

The split-blackjack payout is unusually favorable compared with normal casino blackjack. In most real casinos, Ace + 10 after a split is only a regular 21. GTA-specific player testing reports that GTA pays it as blackjack instead, so the calculator models that behavior.

The probability engine assumes the dealer's blackjack peek has already completed when the player is being offered Hit / Stand / Double / Split. Therefore, when the dealer shows an Ace, the hidden card is conditioned not to be a ten-value card; when the dealer shows a ten-value card, the hidden card is conditioned not to be an Ace.
