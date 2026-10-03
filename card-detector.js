// Screenshot recognition will live here so image parsing stays separate from blackjack math.
// The first version intentionally does not guess card ranks. We need real GTA screenshots to
// calibrate crop regions and confidence thresholds before automatic results are trusted.
export async function detectVisibleCards(_imageSource){
  return {
    ready: false,
    playerCards: [],
    dealerUp: null,
    otherVisible: [],
    confidence: 0,
    message: 'Detector calibration pending GTA screenshot samples.'
  };
}
