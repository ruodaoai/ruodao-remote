import { t } from "../i18n";
export const DANGER_ACTION_LABELS: Record<string, string> = {
  "ctrl-alt-del": t("Ctrl+Alt+Delete 安全界面"),
  "ctrl-shift-esc": t("任务管理器"),
  "alt-f4": t("关闭前台窗口"),
  "win-l": t("锁定对方屏幕"),
  "win-r": t("运行命令框"),
  "win-x": t("系统快捷菜单"),
  "win-u": t("辅助功能中心"),
  power: t("电源相关操作"),
};

export function dangerActionLabel(action: string): string {
  return DANGER_ACTION_LABELS[action] ?? action;
}

export function keyboardDangerAction(event: KeyboardEvent): string | null {
  const ctrl = event.ctrlKey;
  const alt = event.altKey;
  const shift = event.shiftKey;
  const meta = event.metaKey;
  if (ctrl && alt && event.code === "Delete") return "ctrl-alt-del";
  if (ctrl && shift && event.code === "Escape") return "ctrl-shift-esc";
  if (alt && !ctrl && !meta && event.code === "F4") return "alt-f4";
  if (meta && !ctrl && !alt) {
    if (event.code === "KeyL") return "win-l";
    if (event.code === "KeyR") return "win-r";
    if (event.code === "KeyX") return "win-x";
    if (event.code === "KeyU") return "win-u";
  }
  return null;
}

const VK_CONTROL = [0xa2, 0xa3];
const VK_ALT = [0xa4, 0xa5];
const VK_SHIFT = [0xa0, 0xa1];
const VK_META = [0x5b, 0x5c];

function anyPressed(pressed: Set<number>, keys: number[]): boolean {
  return keys.some((key) => pressed.has(key));
}

export function inputDangerAction(vk: number, pressed: Set<number>): string | null {
  const ctrl = anyPressed(pressed, VK_CONTROL);
  const alt = anyPressed(pressed, VK_ALT);
  const shift = anyPressed(pressed, VK_SHIFT);
  const meta = anyPressed(pressed, VK_META);
  if (vk === 0x2e && ctrl && alt) return "ctrl-alt-del";
  if (vk === 0x1b && ctrl && shift) return "ctrl-shift-esc";
  if (vk === 0x73 && alt) return "alt-f4";
  if (!ctrl && !alt) {
    if (meta) {
      if (vk === 0x4c) return "win-l";
      if (vk === 0x52) return "win-r";
      if (vk === 0x58) return "win-x";
      if (vk === 0x55) return "win-u";
    }
  }
  return null;
}
