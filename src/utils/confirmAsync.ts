type ConfirmCallback = (result: boolean) => void;

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmRequest extends ConfirmOptions {
  message: string;
  resolve: ConfirmCallback;
}

let activeConfirm: ConfirmRequest | null = null;
let listeners: ((data: ConfirmRequest | null) => void)[] = [];

let forceNextSignOut = false;

export const markNextSignOutAsForced = () => {
  forceNextSignOut = true;
};

export const consumeForcedSignOut = () => {
  const forced = forceNextSignOut;
  forceNextSignOut = false;
  return forced;
};

export const confirmAsync = (message: string, options: ConfirmOptions = {}): Promise<boolean> => {
  return new Promise((resolve) => {
    activeConfirm = {
      message,
      ...options,
      resolve: (res) => {
        activeConfirm = null;
        listeners.forEach(l => l(null));
        resolve(res);
      },
    };
    listeners.forEach(l => l(activeConfirm));
  });
};

export const subscribeConfirm = (listener: (data: ConfirmRequest | null) => void) => {
  listeners.push(listener);
  listener(activeConfirm);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
};
