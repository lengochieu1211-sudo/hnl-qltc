type ConfirmCallback = (result: boolean) => void;

let activeConfirm: { message: string, resolve: ConfirmCallback } | null = null;
let listeners: ((data: { message: string, resolve: ConfirmCallback } | null) => void)[] = [];

export const confirmAsync = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    activeConfirm = { message, resolve: (res) => {
      activeConfirm = null;
      listeners.forEach(l => l(null));
      resolve(res);
    }};
    listeners.forEach(l => l(activeConfirm));
  });
};

export const subscribeConfirm = (listener: (data: { message: string, resolve: ConfirmCallback } | null) => void) => {
  listeners.push(listener);
  listener(activeConfirm);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
};
