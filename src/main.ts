// Tipografías incluidas en la app (funcionan sin conexión y en cualquier equipo).
import '@fontsource-variable/inter/wght.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-ext-500.css';
import '@fontsource/cormorant-garamond/latin-ext-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/cormorant-garamond/latin-ext-700.css';
import './styles/main.css';

import { App } from './app';
import { createBackend } from './services/backend';
import { NotesService } from './services/notes';
import { AppStateStore } from './storage/appState';
import { DraftJournal } from './storage/drafts';

async function boot(): Promise<void> {
  const host = document.getElementById('app')!;
  const backend = await createBackend();
  const drafts = new DraftJournal();
  const notes = new NotesService(backend, drafts);
  const state = new AppStateStore(backend);

  // Recuperar borradores antes de listar, para que aparezcan en la lista.
  const [recovered] = await Promise.all([notes.recoverDrafts(), state.load()]);

  const app = new App(backend, notes, state);
  app.mount(host);
  await app.start();
  app.recovered(recovered);
}

boot().catch((e) => {
  console.error(e);
  document.body.textContent = `QuickNotes no pudo arrancar: ${e}`;
});
