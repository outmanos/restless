import { services } from 'insomnia-data';

const normalize = (name: string) => name.trim().toLowerCase();

export function uniqueName(name: string, taken: Set<string>, product: string) {
  if (!taken.has(normalize(name))) {
    return name;
  }
  const suffixed = `${name} (${product})`;
  if (!taken.has(normalize(suffixed))) {
    return suffixed;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${product} ${n})`;
    if (!taken.has(normalize(candidate))) {
      return candidate;
    }
  }
}

export async function listExistingProjects() {
  try {
    return (await services.project.list()).map(project => ({ _id: project._id, name: project.name }));
  } catch (error) {
    console.warn('[migration] Could not list the existing projects, so name clashes were not checked:', error);
    return [];
  }
}

// `id` is ignored among the existing names, so a re-run keeps the same name
export function takenNames(existing: { _id: string; name: string }[], claimed: Set<string>, id: unknown) {
  const others = existing.filter(project => project._id !== id).map(project => project.name);
  return new Set([...others, ...claimed].map(normalize));
}
