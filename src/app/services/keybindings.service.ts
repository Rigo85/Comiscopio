import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';
import { DEFAULT_KEYBINDINGS, KeyBinding, parseKeyCombo, eventToCombo } from '../../../shared/keybindings';

/**
 * Manages configurable keyboard shortcuts.
 * Loads overrides from SQLite settings, falls back to defaults.
 * Matches KeyboardEvents to actions.
 */
@Injectable({ providedIn: 'root' })
export class KeybindingsService {
  private bindings: KeyBinding[] = [];
  private comboMap = new Map<string, string>(); // normalized combo → action

  constructor(private electron: ElectronService) {}

  /** Load keybindings: defaults merged with user overrides from settings */
  async load(): Promise<void> {
    this.bindings = DEFAULT_KEYBINDINGS.map(b => ({ ...b }));

    try {
      const settings = await this.electron.getSettings();
      const overrides = (settings as any)['keybindings'];
      if (overrides && typeof overrides === 'string') {
        const parsed = JSON.parse(overrides) as Record<string, string>;
        for (const binding of this.bindings) {
          if (parsed[binding.action]) {
            binding.keys = parsed[binding.action];
          }
        }
      }
    } catch { /* use defaults */ }

    this.rebuildMap();
  }

  /** Match a keyboard event to an action. Returns null if no match. */
  match(event: KeyboardEvent): string | null {
    const combo = eventToCombo(event);
    return this.comboMap.get(combo) ?? null;
  }

  /** Get all current bindings (for display/config UI) */
  getAll(): KeyBinding[] {
    return [...this.bindings];
  }

  /** Update a binding and persist */
  async update(action: string, newKeys: string): Promise<void> {
    const binding = this.bindings.find(b => b.action === action);
    if (!binding) return;

    binding.keys = newKeys;
    this.rebuildMap();
    await this.persist();
  }

  /** Reset all to defaults and persist */
  async resetAll(): Promise<void> {
    this.bindings = DEFAULT_KEYBINDINGS.map(b => ({ ...b }));
    this.rebuildMap();
    await this.persist();
  }

  private rebuildMap(): void {
    this.comboMap.clear();
    for (const binding of this.bindings) {
      // Normalize: store the combo as eventToCombo would produce it
      const parsed = parseKeyCombo(binding.keys);
      const normalized = this.normalizeCombo(parsed);
      this.comboMap.set(normalized, binding.action);
    }
  }

  private normalizeCombo(parsed: { ctrl: boolean; shift: boolean; alt: boolean; key: string }): string {
    const parts: string[] = [];
    if (parsed.ctrl) parts.push('Ctrl');
    if (parsed.shift) parts.push('Shift');
    if (parsed.alt) parts.push('Alt');
    parts.push(parsed.key);
    return parts.join('+');
  }

  private async persist(): Promise<void> {
    const overrides: Record<string, string> = {};
    for (let i = 0; i < this.bindings.length; i++) {
      if (this.bindings[i].keys !== DEFAULT_KEYBINDINGS[i]?.keys) {
        overrides[this.bindings[i].action] = this.bindings[i].keys;
      }
    }
    await this.electron.saveSettings({ keybindings: JSON.stringify(overrides) } as any);
  }
}
