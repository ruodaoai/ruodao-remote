const STORAGE_KEY = "ruodao-remote.onboarding.v1";

export function shouldShowOnboarding(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "done";
  } catch {
    return true;
  }
}

export function markOnboardingDone(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "done");
  } catch {
    // A blocked localStorage only affects the first-run reminder.
  }
}

export function resetOnboarding(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; the guide can still be opened manually.
  }
}
