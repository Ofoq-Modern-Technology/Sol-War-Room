import { create } from 'zustand';

interface AccountStore {
  selectedIds: Set<number>;
  toggle: (id: number) => void;
  toggleAll: (ids: number[], select: boolean) => void;
  clear: () => void;
}

export const useAccountStore = create<AccountStore>((set) => ({
  selectedIds: new Set(),
  toggle: (id) => set((state) => {
    const next = new Set(state.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selectedIds: next };
  }),
  toggleAll: (ids, select) => set((state) => {
    const next = new Set(state.selectedIds);
    ids.forEach(id => select ? next.add(id) : next.delete(id));
    return { selectedIds: next };
  }),
  clear: () => set({ selectedIds: new Set() })
}));
