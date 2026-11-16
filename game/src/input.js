// input.js — keyboard and mouse, collected in one place.
// The simulation polls `keys` and consumes the edge-triggered queues each fixed
// step; rendering never reads devices directly. Pointer lock is requested by the
// HUD's play button; mouse movement accumulates into look deltas the player
// module applies (and scales by its own sensitivity and any scope zoom).

export const input = {
  keys: new Set(),
  lookDX: 0,
  lookDY: 0,
  firing: false, // left mouse held
  aiming: false, // right mouse held (aim down sights)
  locked: false, // pointer lock engaged
  pressed: new Set(), // key codes that went down since the last consume
  clicked: false, // a fresh left press since the last consume (semi-auto fire)
};

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyB', 'KeyE', 'KeyG', 'KeyF', 'Space',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'Tab', 'KeyM', 'KeyQ',
]);

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.aiming = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX || 0;
    input.lookDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      if (!input.firing) input.clicked = true;
      input.firing = true;
    }
    if (e.button === 2) input.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.firing = false;
      input.aiming = false;
    }
  });
}

export function requestLock(canvas) {
  canvas.requestPointerLock?.();
}

// Edge triggers are consumed once per simulation step by whoever polls first.
export function consumePressed(code) {
  if (input.pressed.has(code)) {
    input.pressed.delete(code);
    return true;
  }
  return false;
}
export function consumeClick() {
  const was = input.clicked;
  input.clicked = false;
  return was;
}
export function clearEdges() {
  input.pressed.clear();
  input.clicked = false;
}
