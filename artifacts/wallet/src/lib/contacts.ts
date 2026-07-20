// ── Address book — stored in localStorage ────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  address: string;
  notes?: string;
  addedAt: string;
}

const STORAGE_KEY = "emberchain_contacts";

export function loadContacts(): Contact[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Contact[];
  } catch {
    return [];
  }
}

function save(contacts: Contact[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export function addContact(data: Omit<Contact, "id" | "addedAt">): Contact {
  const contacts = loadContacts();
  const contact: Contact = {
    ...data,
    id: crypto.randomUUID(),
    addedAt: new Date().toISOString(),
  };
  save([...contacts, contact]);
  return contact;
}

export function updateContact(
  id: string,
  updates: Partial<Omit<Contact, "id" | "addedAt">>,
): void {
  save(loadContacts().map((c) => (c.id === id ? { ...c, ...updates } : c)));
}

export function deleteContact(id: string): void {
  save(loadContacts().filter((c) => c.id !== id));
}
