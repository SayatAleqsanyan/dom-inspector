/**
 * @armvs/dom-inspector v2.3.0
 */

export interface InspectorOptions {
  enabled?: boolean | (() => boolean);
  triggerKey?: 'Alt' | 'Control' | 'Meta' | 'Shift';
  freezeOnClick?: boolean;
  cssUrl?: string | null;
}

export interface ExportData {
  selector: string;
  xpath: string;
  tagName: string;
  width: number;
  height: number;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  a11y: { role: string; accessibleName: string; focusable: boolean; };
}

export interface EventHandle { off(): void; }

export interface InspectorEventMap {
  inspect: { element: Element; selector: string; xpath: string; };
  close: Record<string, never>;
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
}

declare const DOMInspector: InspectorInstance;
export default DOMInspector;
export { DOMInspector };
