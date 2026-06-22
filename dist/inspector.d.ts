/**
 * @armvs/dom-inspector v2.5.0
 */

export interface CustomTheme {
  bg?: string; bg2?: string; bg3?: string;
  border?: string; text?: string; muted?: string; accent?: string;
  [key: string]: string | undefined;
}

export interface InspectorOptions {
  enabled?: boolean | (() => boolean);
  triggerKey?: 'Alt' | 'Control' | 'Meta' | 'Shift';
  freezeOnClick?: boolean;
  cssUrl?: string | null;
  theme?: 'dark' | 'light' | CustomTheme;
}

export interface ExportData {
  selector: string; xpath: string; tagName: string;
  width: number; height: number;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  a11y: { role: string; accessibleName: string; focusable: boolean; };
}

export interface MutationEntry {
  type: 'added' | 'removed' | 'attr' | 'text';
  tag: string; attr?: string; time: number;
}

export interface FrameworkInfo {
  framework: 'react' | 'vue' | 'angular';
  name: string;
  hooks?: Array<{ type: string; value?: string }>;
  props?: string[];
  inputs?: string[];
  version?: number | string;
}

export interface EventHandle { off(): void; }

export interface InspectorEventMap {
  inspect: { element: Element; selector: string; xpath: string; };
  close: Record<string, never>;
  mutation: MutationEntry;
}

export interface InspectorInstance {
  init(options?: boolean | (() => boolean) | InspectorOptions): void;
  enable(): void;
  disable(): void;
  destroy(): void;
  on<K extends keyof InspectorEventMap>(event: K, callback: (detail: InspectorEventMap[K]) => void): EventHandle;
  off<K extends keyof InspectorEventMap>(event: K, callback: (detail: InspectorEventMap[K]) => void): void;
  export(): ExportData | null;
  generateStableSelector(element: Element): string;
  setTheme(theme: 'dark' | 'light' | CustomTheme): void;
  patchAddEventListener(target: EventTarget): void;
  clearMutations(): void;
  detectFramework(element: Element): FrameworkInfo | null;
}

declare const DOMInspector: InspectorInstance;
export default DOMInspector;
export { DOMInspector };
