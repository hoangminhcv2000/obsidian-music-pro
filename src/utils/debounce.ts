export function debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T {
  let timer: number | undefined;
  return function debounced(this: unknown, ...args: Parameters<T>) {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  } as T;
}
