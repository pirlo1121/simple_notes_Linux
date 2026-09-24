import type { Command } from './registry';

export const builtinCommands: Command[] = [
  { name: 'new', aliases: ['nueva'], title: 'Nueva nota', args: '[título]', shortcut: 'Ctrl N', run: (c, a) => c.newNote(a) },
  { name: 'search', aliases: ['buscar'], title: 'Buscar notas', args: '[texto]', shortcut: 'Ctrl K', run: (c, a) => c.focusSearch(a) },
  { name: 'pin', aliases: ['fijar'], title: 'Fijar / desfijar la nota actual', shortcut: 'Ctrl D', run: (c) => c.togglePin() },
  { name: 'delete', aliases: ['borrar', 'eliminar'], title: 'Mover la nota actual a la papelera', shortcut: 'Ctrl ⇧ ⌫', run: (c) => c.deleteCurrent() },
  { name: 'today', aliases: ['hoy'], title: 'Abrir la nota de hoy', shortcut: 'Ctrl T', run: (c) => c.openToday() },
  { name: 'recent', aliases: ['recientes'], title: 'Notas abiertas recientemente', shortcut: 'Ctrl E', run: (c) => c.showRecent() },
  { name: 'history', aliases: ['historial'], title: 'Historial de cambios de la nota', shortcut: 'Ctrl H', run: (c) => c.showHistory() },
  { name: 'tags', aliases: ['etiquetas'], title: 'Explorar etiquetas', run: (c) => c.showTags() },
  { name: 'folder', aliases: ['carpeta'], title: 'Abrir ~/.quicknotes en el gestor de archivos', run: (c) => c.openFolder() },
  { name: 'sidebar', aliases: ['lista'], title: 'Mostrar / ocultar la lista de notas', shortcut: 'Ctrl B', run: (c) => c.toggleSidebar() },
  { name: 'dock', aliases: ['acoplar'], title: 'Volver a acoplar la ventana a la derecha', run: (c) => c.dockWindow() },
  { name: 'autostart', title: 'Activar / desactivar inicio automático', run: (c) => c.toggleAutostart() },
  { name: 'help', aliases: ['ayuda', '?'], title: 'Atajos de teclado', shortcut: 'F1', run: (c) => c.showHelp() },
  { name: 'hide', aliases: ['ocultar'], title: 'Ocultar ventana', shortcut: 'Esc', run: (c) => c.hide() },
  { name: 'quit', aliases: ['salir'], title: 'Cerrar QuickNotes por completo', shortcut: 'Ctrl Q', run: (c) => c.quit() },
];
