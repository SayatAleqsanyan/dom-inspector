/**
 * @armvs/dom-inspector — TypeScript definitions
 * Version 3.0.0
 */

// ── PUBLIC INTERFACES ──────────────────────────────────────────────────────

/** Options passed to DOMInspector.init() */
export interface InspectorOptions {
  /**
   * Whether to enable the inspector on init.
   * @default true
   */
  enabled?: boolean | (() => boolean);

  /**
   * Modifier key that must be held to activate hover inspection and pin-on-click.
   * @default 'Alt'
   */
  triggerKey?: 'Alt' | 'Control' | 'Meta' | 'Shift';

  /**
   * When true, any click pins the inspected element (no modifier key required).
   * @default false
   */
  freezeOnClick?: boolean;

  /**
   * URL of the inspector CSS file. Falls back to auto-detection from script src.
   * @default null (auto-detected)
   */
  cssUrl?: string | null;

  /**
   * v2.4 — Initial theme for the inspector panel.
   * Pass 'dark', 'light', or a custom theme object with CSS variable values.
   *
   * @example
   * theme: 'light'
   * theme: { primary: '#00ff88', bg: '#111' }
   * @default 'dark'
   */
  theme?: 'dark' | 'light' | CustomTheme;

  /**
   * Style of the inspector panel header.
   * - `'traffic'` — macOS-style traffic-light close/pin buttons (default)
   * - `'classic'` — simple text-based header
   * @default 'traffic'
   */
  headerStyle?: 'traffic' | 'classic';
}

/**
 * v2.4 — Custom theme object. Keys become CSS variables on the panel:
 * `--insp-{key}: {value}`.
 * Supported keys: bg, bg2, bg3, border, text, muted, accent.
 */
export interface CustomTheme {
  bg?:     string;
  bg2?:    string;
  bg3?:    string;
  border?: string;
  text?:   string;
  muted?:  string;
  accent?: string;
  [key: string]: string | undefined;
}

/** A11y data included in ExportData */
export interface A11yInfo {
  /** Explicit role attribute or inferred ARIA role */
  role: string;
  /** Accessible name resolved from aria-label, aria-labelledby, label[for], title, alt, or text content */
  accessibleName: string;
  /** Whether the element is focusable via keyboard */
  focusable: boolean;
}

/** Data returned by DOMInspector.export() */
export interface ExportData {
  /** Most stable CSS selector for the element */
  selector: string;
  /** XPath expression (prefixed with "(shadow-root)" for shadow DOM elements) */
  xpath: string;
  /** Lowercase tag name */
  tagName: string;
  /** Rendered width in pixels (rounded) */
  width: number;
  /** Rendered height in pixels (rounded) */
  height: number;
  /** All HTML attributes as key-value pairs */
  attributes: Record<string, string>;
  /** All computed CSS properties as key-value pairs */
  styles: Record<string, string>;
  /** Accessibility information */
  a11y: A11yInfo;
}

/** Detail payload emitted with 'inspect' event */
export interface InspectEventDetail {
  element: Element;
  selector: string;
  xpath: string;
}

/** v2.4 — Mutation history entry */
export interface MutationEntry {
  type: 'added' | 'removed' | 'attr' | 'text';
  tag: string;
  attr?: string;
  time: number;
}

/** v2.4 — Detected event listener entry */
export interface EventListenerEntry {
  type: string;
  count: number | '?';
  inferred?: boolean;
}

/** Handle returned by DOMInspector.on() — call .off() to unsubscribe */
export interface EventHandle {
  off(): void;
}

/** Map of event names to their detail payloads */
export interface InspectorEventMap {
  inspect: InspectEventDetail;
  close: Record<string, never>;
  /** v2.4 — fired on every observed DOM mutation */
  mutation: MutationEntry;
}

/** A live instance of the DOM Inspector */
export interface InspectorInstance {
  /**
   * Initialise the inspector.
   * - Pass `true` / `false` to enable/disable simply.
   * - Pass an `InspectorOptions` object for full configuration.
   */
  init(options?: boolean | (() => boolean) | InspectorOptions): void;

  /** Enable inspection (no-op if already enabled; mounts if not yet mounted). */
  enable(): void;

  /** Disable inspection and close the panel (keeps DOM mounted). */
  disable(): void;

  /** Fully remove the inspector from the page and clean up all listeners. */
  destroy(): void;

  /**
   * Register a callback for a named inspector event.
   * @returns An EventHandle with an `.off()` method to unsubscribe.
   */
  on<K extends keyof InspectorEventMap>(
    event: K,
    callback: (detail: InspectorEventMap[K]) => void
  ): EventHandle;

  /**
   * Unregister a previously registered callback.
   */
  off<K extends keyof InspectorEventMap>(
    event: K,
    callback: (detail: InspectorEventMap[K]) => void
  ): void;

  /**
   * Export full inspection data for the currently inspected element.
   * Returns `null` if no element is currently selected.
   */
  export(): ExportData | null;

  /**
   * Generate the most stable possible CSS selector for a given DOM element.
   *
   * Preference order:
   * 1. `#id`
   * 2. `[data-testid="…"]` / `[data-test="…"]` / `[data-cy="…"]` / `[data-qa="…"]`
   * 3. Other `data-*` attributes
   * 4. Unique class combinations
   * 5. Structural `tag:nth-of-type(n)` path (last resort)
   */
  generateStableSelector(element: Element): string;

  /**
   * v2.4 — Change the inspector theme at runtime.
   * @param theme 'dark' | 'light' | CustomTheme object
   */
  setTheme(theme: 'dark' | 'light' | CustomTheme): void;

  /**
   * v2.4 — Monkey-patch a DOM element's addEventListener so the inspector
   * can track all registered listeners on that element.
   * Call once per element you want full event-listener visibility for.
   */
  patchAddEventListener(target: EventTarget): void;

  /**
   * v2.4 — Clear the DOM mutation history log.
   */
  clearMutations(): void;

  /**
   * v2.5 — Manually trigger framework detection on a given element and return
   * the result. Useful for programmatic inspection without opening the panel.
   */
  detectFramework(element: Element): FrameworkInfo | null;

  /**
   * v3.0 — Run the accessibility audit on an element (or the currently
   * inspected element if none given). Returns an array of issues found.
   */
  audit(element?: Element | null): A11yIssue[];

  /**
   * v3.0 — Connect to a remote debugging relay via WebSocket.
   * @param url WebSocket URL of the relay server
   */
  connect(url: string): Promise<{ connected: boolean; url: string }>;

  /** v3.0 — Disconnect from the remote debugging relay. */
  disconnect(): void;

  /**
   * v3.0 — Start a collaboration session. Returns the generated session ID
   * (format: "ABC-DEF-GHI"). Uses BroadcastChannel for same-origin tabs.
   */
  share(): string | null;

  /**
   * v3.0 — Join an existing collaboration session by ID.
   * @param sessionId Session ID returned by share()
   */
  joinSession(sessionId: string): boolean;

  /**
   * v3.0 — Export inspection data in the specified format.
   * @param format 'html' | 'markdown' | 'yaml' — omit for JSON object
   */
  export(format?: 'html' | 'markdown' | 'yaml'): ExportData | string | null;
}

/** v3.0 — Accessibility audit issue */
export interface A11yIssue {
  /** Rule identifier */
  id: string;
  /** Human-readable description of the issue */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
}

/** v2.5 — Result of framework detection on an element */
export interface FrameworkInfo {
  /** Detected framework: 'react' | 'vue' | 'angular' */
  framework: 'react' | 'vue' | 'angular';
  /** Component name */
  name: string;
  /** React hooks summary (React only) */
  hooks?: Array<{ type: string; value?: string }>;
  /** Vue prop names (Vue only) */
  props?: string[];
  /** Angular @Input names (Angular only) */
  inputs?: string[];
  /** Framework version string (Vue and Angular) */
  version?: number | string;
}

// ── MODULE EXPORTS ─────────────────────────────────────────────────────────

/**
 * The singleton DOMInspector instance.
 *
 * @example
 * // ES Module (Vite / Nuxt / Rollup / Webpack 5)
 * import DOMInspector from '@armvs/dom-inspector';
 * import '@armvs/dom-inspector/css';
 * DOMInspector.init();
 *
 * // Named imports (tree-shakeable)
 * import { init, enable, disable } from '@armvs/dom-inspector';
 *
 * // CommonJS (Node.js)
 * const DOMInspector = require('@armvs/dom-inspector');
 *
 * // TypeScript
 * import DOMInspector, { InspectorOptions } from '@armvs/dom-inspector';
 */
declare const DOMInspector: InspectorInstance;

export default DOMInspector;
export { DOMInspector };

// Named re-exports — enable tree-shaking and destructured imports
export declare const init:                   InspectorInstance['init'];
export declare const enable:                 InspectorInstance['enable'];
export declare const disable:                InspectorInstance['disable'];
export declare const destroy:                InspectorInstance['destroy'];
export declare const on:                     InspectorInstance['on'];
export declare const off:                    InspectorInstance['off'];
export declare const generateStableSelector: InspectorInstance['generateStableSelector'];
export declare const setTheme:               InspectorInstance['setTheme'];
export declare const patchAddEventListener:  InspectorInstance['patchAddEventListener'];
export declare const clearMutations:         InspectorInstance['clearMutations'];
export declare const detectFramework:        InspectorInstance['detectFramework'];
export declare const audit:                  InspectorInstance['audit'];
export declare const connect:                InspectorInstance['connect'];
export declare const disconnect:             InspectorInstance['disconnect'];
export declare const share:                  InspectorInstance['share'];
export declare const joinSession:            InspectorInstance['joinSession'];
