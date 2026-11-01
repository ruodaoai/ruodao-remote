import { t, tf } from "../i18n";
export function rejectMessage(reason: string): string {
  switch (reason) {
    case "not-found":
      return t("没有找到这个远控码对应的设备，请确认对方已上线。");
    case "invalid-key":
      return t("访问密钥不正确，请重新核对。");
    case "busy":
      return t("对方正在被其他设备控制，请稍后再试。");
    case "rate-limited":
      return t("尝试次数过于频繁，请一分钟后再试。");
    case "self":
      return t("不能控制本机，请使用另一台设备。");
    case "host-offline":
      return t("对方已离线。");
    case "device-pending":
      return t("本机正在等待管理员批准，暂时还不能远控。");
    case "device-blocked":
      return t("管理员已禁止本机发起远控，请联系服务器管理员。");
    case "device-frozen":
      return t("本机已被管理员临时冻结，请稍后再试。");
    case "server-full":
      return t("服务器当前远控人数已满，请等待他人结束后再试。");
    case "cooldown":
      return t("本次远控已达到时长上限，请等待冷却结束后再试。");
    default:
      return t("连接被拒绝，请稍后再试。");
  }
}

export function accessErrorMessage(reason: string, fallback: string): string {
  switch (reason) {
    case "invite-required":
      return t("此服务器需要邀请码才能接入。请在设置中填写管理员提供的邀请码，然后重新连接。");
    case "invite-invalid":
      return fallback || t("邀请码无效或已过期，请向管理员获取新的邀请码后重试。");
    case "blocked":
      return fallback || t("管理员已禁止此客户端进行远控，如需恢复请联系服务器管理员。");
    case "frozen":
      return fallback || t("此客户端已被管理员临时冻结，请稍后重新连接。");
    case "device-pending":
      return t("服务器正在等待管理员批准此客户端，批准后会自动继续。");
    case "admin-disconnect":
      return fallback || t("管理员已断开此客户端，请稍后重新连接。");
    case "invalid-hello":
      return fallback || t("客户端接入握手失败，请升级到最新版本后再试。");
    case "network":
      return fallback || t("无法接入服务器，请检查服务器地址与网络。");
    default:
      return fallback || t("无法接入服务器，请稍后再试。");
  }
}

export function peerLeftMessage(reason: string, cooldownUntil?: number): string {
  switch (reason) {
    case "controller-left":
      return t("对方已结束控制");
    case "host-closed":
      return t("对方已下线，会话结束");
    case "key-rotated":
      return t("访问密钥已更换，会话已结束");
    case "host-offline":
      return t("对方已离线");
    case "admin-disconnect":
      return t("管理员已结束此会话");
    case "time-limit": {
      if (cooldownUntil) {
        const minutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60_000));
        return tf("已达到本次远控时长上限，请 {0} 分钟后重试", minutes);
      }
      return t("已达到本次远控时长上限，会话已结束");
    }
    case "blocked":
      return t("此设备已被管理员拉黑，连接已结束");
    case "frozen":
      return t("此设备已被管理员冻结，连接已结束");
    default:
      return t("远程会话已结束");
  }
}

export function protocolErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "rate-limited":
      return t("操作过于频繁，请稍后再试。");
    case "already-registered":
      return t("当前连接已注册，请重新上线。");
    case "server-full":
      return t("服务器暂时无法分配远控码，请稍后再试。");
    case "not-in-session":
      return t("当前没有进行中的远程会话。");
    default:
      return fallback || t("服务器返回了错误，请稍后再试。");
  }
}

export function connectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return t("连接失败，请检查服务器地址与网络。");
}

export function captureErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return t("未能获得屏幕录制权限，请在系统设置中允许后重试。");
  }
  if (name === "NotFoundError") {
    return t("没有检测到可共享的屏幕。");
  }
  return t("无法获取屏幕画面，请检查系统屏幕录制权限后重试。");
}
