/**
 * All bindable actions in Comiscopio.
 * Each action maps to a default key combo string.
 *
 * Key format: modifiers + key, joined by '+'.
 * Modifiers: Ctrl, Shift, Alt. Key: the KeyboardEvent.key value.
 * Examples: 'Ctrl+o', 'Shift+ArrowUp', 'F11', ' ' (space), 'ArrowRight'
 */
export interface KeyBinding {
  action: string;
  label: string;
  keys: string; // primary key combo
}

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // File
  { action: 'open-file', label: 'Abrir archivo', keys: 'Ctrl+o' },
  { action: 'close-file', label: 'Cerrar archivo', keys: 'Ctrl+w' },
  { action: 'new-window', label: 'Nueva ventana', keys: 'Ctrl+n' },

  // Navigation
  { action: 'next-page', label: 'Página siguiente', keys: 'ArrowRight' },
  { action: 'prev-page', label: 'Página anterior', keys: 'ArrowLeft' },
  { action: 'next-page-alt', label: 'Página siguiente (alt)', keys: 'PageDown' },
  { action: 'prev-page-alt', label: 'Página anterior (alt)', keys: 'PageUp' },
  { action: 'next-page-alt2', label: 'Página siguiente (espacio)', keys: ' ' },
  { action: 'first-page', label: 'Primera página', keys: 'Home' },
  { action: 'last-page', label: 'Última página', keys: 'End' },
  { action: 'goto-page', label: 'Ir a página...', keys: 'Ctrl+g' },

  // Zoom
  { action: 'zoom-in', label: 'Acercar', keys: 'Ctrl+=' },
  { action: 'zoom-out', label: 'Alejar', keys: 'Ctrl+-' },
  { action: 'zoom-reset', label: 'Restablecer zoom', keys: 'Ctrl+0' },

  // Filters
  { action: 'brightness-up', label: 'Aumentar brillo', keys: 'Shift+ArrowUp' },
  { action: 'brightness-down', label: 'Reducir brillo', keys: 'Shift+ArrowDown' },
  { action: 'contrast-up', label: 'Aumentar contraste', keys: 'Shift+ArrowRight' },
  { action: 'contrast-down', label: 'Reducir contraste', keys: 'Shift+ArrowLeft' },
  { action: 'reset-filters', label: 'Restablecer filtros', keys: 'i' },

  // Modes
  { action: 'cycle-reading-mode', label: 'Cambiar modo lectura', keys: 'r' },
  { action: 'toggle-page-layout', label: 'Simple/Doble página', keys: 'd' },
  { action: 'cycle-fit-mode', label: 'Cambiar ajuste', keys: 'f' },

  // UI
  { action: 'toggle-thumbnails', label: 'Mostrar miniaturas', keys: 't' },
  { action: 'toggle-zen', label: 'Modo zen', keys: 'z' },
  { action: 'toggle-fullscreen', label: 'Pantalla completa', keys: 'F11' },
  { action: 'add-bookmark', label: 'Agregar marcador', keys: 'b' },
];

/**
 * Parse a key combo string into its components for matching.
 */
export function parseKeyCombo(combo: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = combo.split('+');
  let ctrl = false, shift = false, alt = false;
  let key = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl') ctrl = true;
    else if (lower === 'shift') shift = true;
    else if (lower === 'alt') alt = true;
    else key = part; // preserve original case for key
  }

  // Handle '+' key itself (e.g. 'Ctrl+=')
  if (combo.endsWith('+') && parts.length > 1) {
    key = '+';
  }

  return { ctrl, shift, alt, key };
}

/**
 * Convert a KeyboardEvent to a combo string.
 */
export function eventToCombo(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  parts.push(event.key);
  return parts.join('+');
}
