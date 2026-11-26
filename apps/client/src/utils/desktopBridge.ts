export interface DesktopInfo {
  platform: string;
  arch: string;
  version: string;
  appName: string;
}

type UnlistenFn = () => void;

interface TauriGlobal {
  core?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event?: {
    listen?: <T>(
      event: string,
      handler: (event: { payload: T }) => void,
    ) => Promise<UnlistenFn>;
  };
}

function getTauriGlobal(): TauriGlobal | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: {
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
  if (win.__TAURI__) return win.__TAURI__;
  if (win.__TAURI_INTERNALS__?.invoke) {
    return { core: { invoke: win.__TAURI_INTERNALS__.invoke } };
  }
  return null;
}

function getTauriInvoke():
  | (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)
  | null {
  return getTauriGlobal()?.core?.invoke ?? null;
}

export function isRunningInTauriDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return (
    Boolean(win.__TAURI_INTERNALS__) ||
    Boolean(win.__TAURI__) ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost' ||
    window.location.hostname.endsWith('.tauri.localhost')
  );
}

export async function getDesktopInfo(): Promise<DesktopInfo | null> {
  const invoke = getTauriInvoke();
  if (!invoke) return null;
  try {
    return await invoke<DesktopInfo>('get_desktop_info');
  } catch {
    return null;
  }
}

export async function getDesktopFullscreen(): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>('is_fullscreen');
  } catch {
    return false;
  }
}

export async function toggleDesktopFullscreen(): Promise<boolean | null> {
  const invoke = getTauriInvoke();
  if (!invoke) return null;
  try {
    return await invoke<boolean>('toggle_fullscreen');
  } catch {
    return null;
  }
}

export async function resetDesktopWindowSize(): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) return false;
  try {
    await invoke<void>('reset_window_size');
    return true;
  } catch {
    return false;
  }
}

export async function requestDesktopAttention(urgent = true): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>('request_user_attention', { urgent });
  } catch {
    return false;
  }
}

export async function clearDesktopAttention(): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke<void>('clear_user_attention');
  } catch {
    // ignore
  }
}

export async function setActiveMatchGuard(active: boolean): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke<void>('set_active_match_guard', { active });
  } catch {
    // ignore
  }
}

export async function forceCloseDesktopApp(): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke<void>('force_close_app');
  } catch {
    // ignore
  }
}

export async function listenDesktopCloseRequested(
  handler: () => void,
): Promise<UnlistenFn> {
  const listen = getTauriGlobal()?.event?.listen;
  if (!listen) return () => {};
  try {
    return await listen('jinshan://close-requested', () => {
      handler();
    });
  } catch {
    return () => {};
  }
}
