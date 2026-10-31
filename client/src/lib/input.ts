export type MouseButton = "left" | "middle" | "right";
export type InputAction = "down" | "up";

export type InputEventPayload =
  | { kind: "mouse-move"; x: number; y: number }
  | { kind: "mouse-button"; button: MouseButton; action: InputAction }
  | { kind: "wheel"; delta: number }
  | { kind: "key"; action: InputAction; vk: number; extended?: boolean };

const VK: Record<string, number> = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  PrintScreen: 0x2c,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
  NumLock: 0x90,
  ScrollLock: 0x91,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  NumpadEnter: 0x0d,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
};

for (let i = 0; i < 26; i += 1) {
  VK[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i;
}
for (let i = 0; i < 10; i += 1) {
  VK[`Digit${i}`] = 0x30 + i;
  VK[`Numpad${i}`] = 0x60 + i;
}
for (let i = 1; i <= 12; i += 1) {
  VK[`F${i}`] = 0x6f + i;
}

const EXTENDED_CODES = new Set([
  "ArrowLeft",
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "NumpadEnter",
  "NumpadDivide",
  "ControlRight",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "PrintScreen",
  "ContextMenu",
]);

export function keyboardEventToInput(event: KeyboardEvent, down: boolean): InputEventPayload | null {
  const vk = VK[event.code];
  if (!vk) return null;
  return {
    kind: "key",
    action: down ? "down" : "up",
    vk,
    extended: EXTENDED_CODES.has(event.code),
  };
}

export function pointerButton(button: number): MouseButton | null {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return null;
}

export function isRendererInputEvent(value: unknown): value is InputEventPayload {
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
