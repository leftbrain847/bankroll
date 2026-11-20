/** Tiny DOM helpers. No innerHTML anywhere: all text goes in as text, so nothing a player types can run as code. */
export interface ElOptions {
  text?: string;
  className?: string;
  onClick?: () => void;
  attrs?: Record<string, string>;
  disabled?: boolean;
  style?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: ElOptions = {}, children: (Node | null | false)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.className) node.className = opts.className;
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.disabled) (node as HTMLButtonElement).disabled = true;
  if (opts.style) for (const [k, v] of Object.entries(opts.style)) node.style.setProperty(k, v);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

export function render(root: Node): void {
  const app = document.getElementById('app');
  if (app) app.replaceChildren(root);
}

export const button = (text: string, onClick: () => void, className = '', disabled = false): HTMLButtonElement =>
  el('button', { text, onClick, className, disabled, attrs: { type: 'button' } });

/** Wrap localStorage: it can be missing or throw (private windows, artifact previews). */
export const store = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage unavailable: play on without saving */
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
