/** Id corto, ordenable y seguro como nombre de directorio: [a-z0-9-]. */
export function newId(): string {
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `${Date.now().toString(36)}-${rand}`;
}
