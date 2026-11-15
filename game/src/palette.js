// The look plan, in one place: a dusk container port in six colours plus the two
// team colours. Sodium lamps give the accent, harbour teal marks the Wardens.
// The same names are the CSS custom properties in index.html, and every material
// in the game is built from these values, so no other colour appears.
export const PALETTE = {
  canvas: '#0d1219', // dusk sky and ground shadow
  surface: '#1b232e', // container steel, walls
  hairline: '#333f4d', // trim, dark metal
  ink: '#ece7db', // lit concrete, paper white
  muted: '#93a5b3', // weathered blue-grey
  accent: '#ff8c3a', // sodium orange: the Runners, warnings, muzzle light
  warden: '#63d6bd', // harbour teal: the Wardens, friendly readouts
};

export const TEAM_COLORS = {
  warden: PALETTE.warden,
  runner: PALETTE.accent,
};

// A dusk gradient the world paints on the sky dome, darkest at the horizon line
// the fog eats, so distance reads as evening haze rather than a void.
export const SKY_TOP = '#1d2f45';
export const SKY_HORIZON = '#4a3f3a';
