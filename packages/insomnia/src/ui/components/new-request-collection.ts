import { NewRequestCollection } from 'insomnia-data/common';

// The collection chosen in the home screen's New request box, remembered for each project
const CHOICE_KEY = 'new-request-collection';

export const readCollectionChoice = (projectId: string): string | null => {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}')[projectId] ?? null;
  } catch {
    return null;
  }
};

export const rememberCollectionChoice = (projectId: string, collectionId: string) => {
  try {
    const all = JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}');
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ ...all, [projectId]: collectionId }));
  } catch {
    // Remembering is a convenience, so blocked or full storage is fine
  }
};

// Keeps the choice made on this screen. Otherwise the remembered one, if the setting is the last one used, and the
// first collection in the list as a last resort.
export const pickCollection = (
  items: { id: string }[],
  current: string | null,
  remembered: string | null,
  preference: NewRequestCollection,
): string | null => {
  const exists = (id: string | null): id is string => !!id && items.some(item => item.id === id);
  if (exists(current)) {
    return current;
  }
  if (preference === NewRequestCollection.lastUsed && exists(remembered)) {
    return remembered;
  }
  return items[0]?.id ?? null;
};
