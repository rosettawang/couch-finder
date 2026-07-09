// Best-effort extraction of couch dimensions (width/depth/height in inches)
// from free-text titles/descriptions, since none of these marketplaces expose
// structured dimension fields. Listings that don't mention dimensions in a
// recognizable format are returned with parsed: false rather than excluded,
// so the user can still eyeball them.

// Matches things like:
//  84x36x32 | 84" x 36" x 32" | 84 x 36 x 32 in
//  W84 x D36 x H32 | 84"W 36"D 32"H
//  84 long, 36 deep, 32 high
const TRIPLE_NUMBER_RE =
  /(\d{2,3}(?:\.\d+)?)\s*(?:"|in|inches)?\s*(?:w|wide|width|long|length)?\s*[x×by]\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|in|inches)?\s*(?:d|deep|depth)?\s*[x×by]\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|in|inches)?\s*(?:h|high|height|tall)?/i;

const LABELED_RE =
  /(?:w(?:idth)?|width)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)["']?.*?(?:d(?:epth)?|depth)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)["']?.*?(?:h(?:eight)?|height)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)["']?/i;

function parseDimensionsFromText(text) {
  if (!text) return { width: null, depth: null, height: null, parsed: false, raw: null };

  const labeled = text.match(LABELED_RE);
  if (labeled) {
    return {
      width: parseFloat(labeled[1]),
      depth: parseFloat(labeled[2]),
      height: parseFloat(labeled[3]),
      parsed: true,
      raw: labeled[0],
    };
  }

  const triple = text.match(TRIPLE_NUMBER_RE);
  if (triple) {
    return {
      width: parseFloat(triple[1]),
      depth: parseFloat(triple[2]),
      height: parseFloat(triple[3]),
      parsed: true,
      raw: triple[0],
    };
  }

  return { width: null, depth: null, height: null, parsed: false, raw: null };
}

// target: { width: {min,max}, depth: {min,max}, height: {min,max} } -- any subset.
// Returns 'match' | 'no_match' | 'unknown' (dims not parsed from listing text).
function matchesDimensions(parsed, target, toleranceIn = 2) {
  if (!target || Object.keys(target).length === 0) return 'match';
  if (!parsed || !parsed.parsed) return 'unknown';

  for (const key of ['width', 'depth', 'height']) {
    const range = target[key];
    if (!range) continue;
    const value = parsed[key];
    if (value === null || value === undefined) return 'unknown';
    const min = (range.min ?? -Infinity) - toleranceIn;
    const max = (range.max ?? Infinity) + toleranceIn;
    if (value < min || value > max) return 'no_match';
  }
  return 'match';
}

module.exports = { parseDimensionsFromText, matchesDimensions };
