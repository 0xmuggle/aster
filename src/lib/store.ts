import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { HedgeOrder, HedgeOrderDraft, HedgeOrderStatus, User } from "./types";

interface AppState {
  orders: HedgeOrder[];

  users: User[];
  updateUser: (name: string, vol: number) => void;
  addUser: (user: User) => void;
  deleteUser: (name: string) => void;
  addOrder: (draft: HedgeOrderDraft) => void;
  updateOrder: (id: string, updates: Partial<HedgeOrderDraft>) => void;
  setOrderStatus: (id: string, status: HedgeOrderStatus) => void;
  deleteOrder: (id: string) => void;
}

const generateOrderId = () =>
  `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      orders: [],

      users: [], // 示例：[{ id: 1, name: 'Alice', symbol: 'USER1' }, ...]
      // 添加用户
      addUser: (user: User) =>
        set((state) => ({ users: [...state.users, user] })),
      deleteUser: (name: string) =>
        set((state) => ({
          users: state.users.filter((item) => item.name !== name),
        })),
      updateUser: (name: string, vol: number) => {
        set((state) => ({
          users: state.users.map((user) =>
            user.name === name
              ? {
                  ...user,
                  vol: Number(user.vol || 0) + vol,
                  txs: Number(user.txs) + 1,
                }
              : user
          ),
        }));
      },
      addOrder: (draft: HedgeOrderDraft) => {
        const timestamp = new Date().toISOString();
        const newOrder: HedgeOrder = {
          id: generateOrderId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          status: "draft",
          ...draft,
        };
        set((state) => ({ orders: [newOrder, ...state.orders] }));
      },
      updateOrder: (id: string, updates: Partial<HedgeOrderDraft>) => {
        const timestamp = new Date().toISOString();
        set((state) => ({
          orders: state.orders.map((order) =>
            order.id === id
              ? {
                  ...order,
                  ...updates,
                  updatedAt: timestamp,
                }
              : order
          ),
        }));
      },
      setOrderStatus: (id: string, status: HedgeOrderStatus) => {
        const timestamp = new Date().toISOString();
        set((state) => ({
          orders: state.orders.map((order) => {
            if (order.id === id) {
              return {
                ...order,
                status,
                updatedAt: timestamp,
              };
            }
            return order;
          }),
        }));
      },
      deleteOrder: (id: string) =>
        set((state) => ({
          orders: state.orders.filter((order) => order.id !== id),
        })),
    }),
    {
      name: "app-storage", // localStorage 的 key
      storage: createJSONStorage(() => localStorage), // 使用 localStorage
      partialize: (state) => ({
        orders: state.orders,
        users: state.users,
      }),
    }
  )
);
