import koffi from "koffi";

export type MouseButton = "left" | "middle" | "right";
export type InputAction = "down" | "up";

export type InputEventPayload =
  | { kind: "mouse-move"; x: number; y: number }
  | { kind: "mouse-button"; button: MouseButton; action: InputAction }
  | { kind: "wheel"; delta: number }
  | { kind: "key"; action: InputAction; vk: number; extended?: boolean };

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;

const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;

const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_ABSOLUTE = 0x8000;

const BUTTON_FLAGS: Record<MouseButton, { down: number; up: number }> = {
  left: { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP },
  right: { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP },
  middle: { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP },
};

interface NativeInput {
  mouse(flags: number, dx: number, dy: number, mouseData: number): void;
  key(vk: number, flags: number): void;
  cursor(): { x: number; y: number };
}

let native: NativeInput | null = null;
let loadAttempted = false;

function ensureNative(): NativeInput | null {
  if (loadAttempted) return native;
  loadAttempted = true;
  if (process.platform !== "win32") return null;
  try {
    const user32 = koffi.load("user32.dll");
    const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
      dx: "int32",
      dy: "int32",
      mouseData: "uint32",
      dwFlags: "uint32",
      time: "uint32",
      dwExtraInfo: "uint64",
    });
    const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
      wVk: "uint16",
      wScan: "uint16",
      dwFlags: "uint32",
      time: "uint32",
      dwExtraInfo: "uint64",
    });
    const HARDWAREINPUT = koffi.struct("HARDWAREINPUT", {
      uMsg: "uint32",
      wParamL: "uint16",
      wParamH: "uint16",
    });
    const INPUT_UNION = koffi.union("INPUT_UNION", {
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
      hi: HARDWAREINPUT,
    });
    const INPUT = koffi.struct("INPUT", { type: "uint32", u: INPUT_UNION });
    const size = koffi.sizeof(INPUT);
    const sendInput = user32.func(
      "uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)",
    ) as unknown as (count: number, inputs: unknown[], size: number) => number;

    koffi.struct("RUODAO_POINT", { x: "int32", y: "int32" });
    const getCursorPos = user32.func(
      "bool GetCursorPos(_Out_ RUODAO_POINT *pos)",
    ) as unknown as (point: { x: number; y: number }) => boolean;

    const send = (input: unknown): void => {
      try {
        sendInput(1, [input], size);
      } catch {
        // A rejected injection must not crash the host process.
      }
    };

    native = {
      mouse(flags, dx, dy, mouseData) {
        send({
          type: INPUT_MOUSE,
          u: { mi: { dx, dy, mouseData, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        });
      },
      key(vk, flags) {
        send({
          type: INPUT_KEYBOARD,
          u: { ki: { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        });
      },
      cursor() {
        const point = { x: 0, y: 0 };
        if (!getCursorPos(point)) throw new Error("GetCursorPos failed");
        return point;
      },
    };
    return native;
  } catch {
    native = null;
    return null;
  }
}

const pressedKeys = new Map<number, boolean>();
const pressedButtons = new Set<MouseButton>();
let appliedEvents = 0;
let lastApplied: InputEventPayload | null = null;

export function inputAvailable(): boolean {
  return ensureNative() !== null;
}

export function appliedInputCount(): number {
  return appliedEvents;
}

export function lastAppliedInput(): InputEventPayload | null {
  return lastApplied;
}

export function readCursorPosition(): { x: number; y: number } | null {
  const api = ensureNative();
  if (!api) return null;
  try {
    return api.cursor();
  } catch {
    return null;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function injectMouseMove(x: number, y: number): void {
  const api = ensureNative();
  if (!api) return;
  const dx = Math.round(clamp01(x) * 65535);
  const dy = Math.round(clamp01(y) * 65535);
  api.mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, dx, dy, 0);
}

export function injectMouseButton(button: MouseButton, action: InputAction): void {
  const api = ensureNative();
  if (!api) return;
  const flags = BUTTON_FLAGS[button];
  if (!flags) return;
  if (action === "down") pressedButtons.add(button);
  else pressedButtons.delete(button);
  api.mouse(action === "down" ? flags.down : flags.up, 0, 0, 0);
}

export function injectWheel(delta: number): void {
  const api = ensureNative();
  if (!api) return;
  const clamped = Math.max(-2400, Math.min(2400, Math.trunc(delta)));
  if (clamped === 0) return;
  const mouseData = clamped < 0 ? clamped + 0x1_0000_0000 : clamped;
  api.mouse(MOUSEEVENTF_WHEEL, 0, 0, mouseData);
}

export function injectKey(action: InputAction, vk: number, extended = false): void {
  const api = ensureNative();
  if (!api) return;
  if (vk <= 0 || vk > 0xff) return;
  if (action === "down") pressedKeys.set(vk, extended);
  else pressedKeys.delete(vk);
  let flags = extended ? KEYEVENTF_EXTENDEDKEY : 0;
  if (action === "up") flags |= KEYEVENTF_KEYUP;
  api.key(vk, flags);
}

export function releaseAllInput(): void {
  const api = ensureNative();
  if (!api) {
    pressedKeys.clear();
    pressedButtons.clear();
    return;
  }
  for (const [vk, extended] of pressedKeys) {
    let flags = extended ? KEYEVENTF_EXTENDEDKEY : 0;
    flags |= KEYEVENTF_KEYUP;
    api.key(vk, flags);
  }
  pressedKeys.clear();
  for (const button of pressedButtons) {
    api.mouse(BUTTON_FLAGS[button].up, 0, 0, 0);
  }
  pressedButtons.clear();
}

export function applyInputEvent(event: InputEventPayload): void {
  appliedEvents += 1;
  lastApplied = event;
  switch (event.kind) {
    case "mouse-move":
      injectMouseMove(event.x, event.y);
      break;
    case "mouse-button":
      injectMouseButton(event.button, event.action);
      break;
    case "wheel":
      injectWheel(event.delta);
      break;
    case "key":
      injectKey(event.action, event.vk, event.extended === true);
      break;
  }
}

export function isInputEventPayload(value: unknown): value is InputEventPayload {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  switch (event.kind) {
    case "mouse-move":
      return (
        typeof event.x === "number" &&
        typeof event.y === "number" &&
        Number.isFinite(event.x) &&
        Number.isFinite(event.y) &&
        event.x >= 0 &&
        event.x <= 1 &&
        event.y >= 0 &&
        event.y <= 1
      );
    case "mouse-button":
      return (
        (event.button === "left" || event.button === "middle" || event.button === "right") &&
        (event.action === "down" || event.action === "up")
      );
    case "wheel":
      return (
        typeof event.delta === "number" &&
        Number.isFinite(event.delta) &&
        Math.abs(event.delta) <= 2400
      );
    case "key":
      return (
        (event.action === "down" || event.action === "up") &&
        typeof event.vk === "number" &&
        Number.isInteger(event.vk) &&
        event.vk > 0 &&
        event.vk <= 0xff &&
        (event.extended === undefined || typeof event.extended === "boolean")
      );
    default:
      return false;
  }
}
