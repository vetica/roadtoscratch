// Drill library. Each drill belongs to one area and can be done at one or more venues.
// score: how the drill is scored (null = reps only). lowerBetter flips the trend direction.

const AREAS = {
  tee:      { name: 'Off the tee',        short: 'Tee',      color: 'var(--c-tee)' },
  approach: { name: 'Approach & contact', short: 'Approach', color: 'var(--c-approach)' },
  short:    { name: 'Short game',         short: 'Short',    color: 'var(--c-short)' },
  putt:     { name: 'Putting',            short: 'Putting',  color: 'var(--c-putt)' },
};

const VENUES = {
  home:      { name: 'Home',            areas: ['putt', 'short', 'approach', 'tee'], fullSwing: false },
  shortgame: { name: 'Short-game area', areas: ['putt', 'short'],                    fullSwing: false },
  range:     { name: 'Range',           areas: ['tee', 'approach', 'short'],         fullSwing: true },
  sim:       { name: 'Simulator',       areas: ['tee', 'approach', 'short'],         fullSwing: true },
  course:    { name: 'Round (course or sim)', areas: [],                             fullSwing: true },
  rest:      { name: 'Rest',            areas: [],                                   fullSwing: false },
};

// Mirrors the Fitbod plan: lifts A-D, walk + mobility, mobility only, rest.
const BODY = {
  liftA:    { name: 'Lift A: heavy lower + core',     short: 'Lift A', lift: true },
  liftB:    { name: 'Lift B: upper + rotational',     short: 'Lift B', lift: true },
  liftC:    { name: 'Lift C: power + single-leg',     short: 'Lift C', lift: true },
  liftD:    { name: 'Lift D (optional, from Jan 2027)', short: 'Lift D', lift: true },
  walkmob:  { name: 'Walk + 25 min mobility',         short: 'Walk + mob', lift: false },
  mobility: { name: '25 min mobility, no lift',       short: 'Mobility', lift: false },
  rest:     { name: 'Rest (12 min daily mobility)',   short: 'Rest', lift: false },
};

// Fitbod plan phases. Every 4th week of a phase is a deload.
const PHASES = [
  { name: 'Foundation', start: '2026-11-02', end: '2026-12-27' },
  { name: 'Strength',   start: '2027-01-04', end: '2027-03-28' },
  { name: 'Power',      start: '2027-04-05', end: '2027-05-30' },
  { name: 'In-season',  start: '2027-06-07', end: '2027-09-26', note: '2-3 lifts a week' },
  { name: 'Review',     start: '2027-10-01', end: '2027-10-31' },
];

const DRILLS = [
  // Putting
  { id: 'p-gate', area: 'putt', venues: ['home', 'shortgame'], name: 'Gate drill (start line)',
    how: 'Two tees just wider than the ball, 12 in in front of it, on a straight 4 ft putt. Hit 10. Count putts that pass through the gate and go in.',
    score: { label: 'makes', max: 10 } },
  { id: 'p-circle', area: 'putt', venues: ['home', 'shortgame'], name: 'Circle drill 3-4-5 ft',
    how: '6 balls around the hole at 3 ft, then 4 ft, then 5 ft. A miss sends you back to the start of that ring. Count total makes before time runs out.',
    score: { label: 'makes', max: 18 } },
  { id: 'p-streak', area: 'putt', venues: ['home', 'shortgame'], name: 'Pressure 3-footers',
    how: 'Full routine on every putt. Goal is 25 in a row from 3 ft. Restart on a miss. Record your longest streak.',
    score: { label: 'longest streak', max: 25 } },
  { id: 'p-matspeed', area: 'putt', venues: ['home'], name: 'Mat speed control',
    how: 'From the far end of the mat, putt 10 balls that would finish no more than 17 in past the cup (use a coin as a marker). Count balls that hold the zone.',
    score: { label: 'in zone', max: 10 } },
  { id: 'p-lag', area: 'putt', venues: ['shortgame'], name: 'Lag ladder 20-30-40 ft',
    how: '3 balls each from 20, 30 and 40 ft. Count balls that finish inside a putter length. Two-putt any that miss.',
    score: { label: 'inside 3 ft', max: 9 } },
  { id: 'p-par18', area: 'putt', venues: ['shortgame'], name: 'Par 18',
    how: '9 holes on the practice green, random lengths 5 to 40 ft, hole everything out. Par is 2 per hole. Record total putts.',
    score: { label: 'putts', max: 27, lowerBetter: true } },

  // Short game
  { id: 's-towel', area: 'short', venues: ['home', 'shortgame'], name: 'Landing-spot towel',
    how: 'Put a hand towel 3 paces onto the green (or in the yard). Chip 10 balls with one club and count those that land on the towel.',
    score: { label: 'on towel', max: 10 } },
  { id: 's-basket', area: 'short', venues: ['home'], name: 'Chip to basket',
    how: 'Foam or real balls into a laundry basket 5 to 10 yd away, changing distance every 5 balls. Feet narrow, weight left, quiet hands. 20 balls.',
    score: { label: 'in basket', max: 20 } },
  { id: 's-updown', area: 'short', venues: ['shortgame'], name: 'Up-and-down 9',
    how: '9 balls from different lies: fringe, light rough, thick rough, uphill, downhill, bunker. Play each and hole out. Count saves.',
    score: { label: 'saves', max: 9 } },
  { id: 's-traj', area: 'short', venues: ['shortgame'], name: 'One club, three flights',
    how: 'With your 56, hit 5 low, 5 stock and 5 high pitches to the same flag 20 yd away. Count balls finishing inside 6 ft.',
    score: { label: 'inside 6 ft', max: 15 } },
  { id: 's-bunker', area: 'short', venues: ['shortgame'], name: 'Bunker line drill',
    how: 'Draw a line in the sand. 10 swings without a ball, then 10 with a ball just ahead of the line. Count shots where the club enters at or just behind the line and the ball gets out.',
    score: { label: 'clean', max: 10 } },
  { id: 's-ladder', area: 'short', venues: ['range', 'sim'], name: 'Wedge ladder 30-45-60-75',
    how: '3 balls each at 30, 45, 60 and 75 yd carry. Count shots within 5 yd of the number (use the sim readout or a range flag).',
    score: { label: 'within 5 yd', max: 12 } },

  // Off the tee
  { id: 't-corridor', area: 'tee', venues: ['range', 'sim'], name: 'Fairway corridor',
    how: 'Pick two targets 30 yd apart as the fairway edges. 14 drivers, full pre-shot routine, new target each ball. Count fairways and note how many miss right.',
    score: { label: 'fairways', max: 14 } },
  { id: 't-path', area: 'tee', venues: ['sim', 'range'], name: 'Fix the right miss',
    how: 'On the sim, hit 5 drivers and read club path and face-to-path. Open face to an out-to-in path means a slice: set a headcover just outside the ball. Face open to an in-to-out path means a push: move it inside. Hit 10 more and count shots that start on line without touching the headcover.',
    score: { label: 'on line', max: 10 } },
  { id: 't-gate', area: 'tee', venues: ['range', 'sim'], name: 'Start-line gate',
    how: 'Two alignment sticks 1 yd apart, 5 yd in front of the ball on your target line. 10 drivers. Count balls that start through the gate.',
    score: { label: 'through gate', max: 10 } },
  { id: 't-mirror', area: 'tee', venues: ['home'], name: 'Slow-motion driver reps',
    how: 'No ball. 20 reps at half speed in front of a mirror or phone camera. Stop at hip height on the way down and check the clubface matches your spine angle. Film reps 1 and 20.',
    score: null },

  // Approach and contact
  { id: 'a-line', area: 'approach', venues: ['range', 'sim'], name: 'Towel strike drill',
    how: 'Lay a towel 4 in behind the ball. Hit 10 seven-irons without touching the towel. Count clean strikes. This is the main fix for fat shots.',
    score: { label: 'clean', max: 10 } },
  { id: 'a-disp', area: 'approach', venues: ['sim', 'range'], name: '7-iron dispersion',
    how: '10 seven-irons at a 170 yd target. Count shots within 7 yd of target carry and 10 yd of the line. Write how many missed left.',
    score: { label: 'on target', max: 10 } },
  { id: 'a-feet', area: 'approach', venues: ['range', 'sim'], name: 'Feet-together irons',
    how: 'Feet touching, three-quarter swings with an 8-iron. 10 balls. Balance and centered contact matter, distance does not. Count solid strikes.',
    score: { label: 'solid', max: 10 } },
  { id: 'a-combine', area: 'approach', venues: ['sim'], name: 'Random approach combine',
    how: 'Sim practice mode: 9 shots at random targets from 80 to 180 yd, new club every ball, full routine. Count shots finishing within 10 percent of the distance.',
    score: { label: 'within 10%', max: 9 } },
  { id: 'a-lowpoint', area: 'approach', venues: ['home'], name: 'Low-point line (no ball)',
    how: 'Put a strip of tape on your mat or a line on a towel. 20 swings with a 7-iron; the brush mark must start on or ahead of the line. Count good reps.',
    score: { label: 'ahead of line', max: 20 } },
  { id: 'a-pump', area: 'approach', venues: ['home'], name: 'Pump and hold impact',
    how: 'No ball. 20 reps: swing to the top, pump down to impact and hold 3 seconds with hands ahead of the clubhead and about 70 percent of your weight on the lead foot.',
    score: null },
];

const BLOCK_EXTRAS = {
  warmup: { name: 'Warm-up', how: 'Your 12-min daily mobility routine from the Fitbod plan, then 10 easy wedges building up to 7-iron. Protects your back on full-swing days.' },
  course: { name: 'Play and log the round', how: 'Course or sim, 9 or 18. Track per hole on the card: fairway (hit, left, right), green in regulation, putts, penalty strokes, up-and-down tries and saves. Enter it in the Log tab afterwards and pick Course or Simulator.' },
  rest:   { name: 'No golf today', how: 'Do your daily mobility from the Fitbod plan. Rest is part of the plan, especially if your back is sore.' },
};
