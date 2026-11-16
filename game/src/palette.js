// palette.js — SLAGLINE's one colour story: a dusk foundry.
// Slate and charcoal iron, molten orange for the EMBER attackers, coolant teal for the
// WARDEN defenders, bone-white ink. Every material in the game is built from these, so
// a screenshot reads as one place in one light instead of a pile of defaults.

export const PALETTE = {
  sky: 0x2b3442, // dusk blue-grey above the yard
  fog: 0x3a3f47,
  ground: 0x4a4640, // ash-stained concrete
  groundDark: 0x38352f,
  iron: 0x565d66, // painted structural steel
  ironDark: 0x33373d,
  rust: 0x8a5a33,
  crate: 0x77684f, // timber-and-steel crates
  crateDark: 0x5b4f3a,
  ember: 0xff7a26, // EMBER team + furnace glow
  emberHot: 0xffb03a,
  warden: 0x37d0c4, // WARDEN team + coolant light
  wardenDeep: 0x1d7a78,
  ink: 0xe8e3d8,
  hazard: 0xf2b13a, // painted warning yellow
  blood: 0xff5a3c, // hit sparks (no gore: hot metal, not blood)
  smoke: 0x9aa0a4,
};

// Team colours by team id (0 EMBER, 1 WARDEN).
export const TEAM_COLORS = [PALETTE.ember, PALETTE.warden];
export const TEAM_COLORS_DEEP = [0xb34d12, PALETTE.wardenDeep];
