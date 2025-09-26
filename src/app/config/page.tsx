"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { useExtension } from "@/components/EProvider";

export default function ConfigPage() {
  const { accountMap } = useExtension();
  const { users, addUser, deleteUser } = useStore();
  const [newAccount, setNewAccount] = useState({ name: "", apiKey: "", apiSecret: "" });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewAccount((prev) => ({ ...prev, [name]: value }));
  };

  // Add a new account
  const addAccount = () => {
    if (newAccount.name && newAccount.apiKey && newAccount.apiSecret) {
      addUser(newAccount);
      setNewAccount({ name: "", apiKey: "", apiSecret: "" });
    } else {
      alert("Please fill in all fields.");
    }
  };

  return (
    <div>
      {/* Add Account Form */}
      <div className="mb-8 p-4 bg-gray-50 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">添加账户</h2>
        <div className="flex gap-4">
          <input
            type="text"
            name="name"
            placeholder="Account Name"
            value={newAccount.name}
            onChange={handleInputChange}
            className="p-2 rounded bg-gray-100"
          />
          <input
            type="text"
            name="apiKey"
            placeholder="API Key"
            value={newAccount.apiKey}
            onChange={handleInputChange}
            className="p-2 rounded bg-gray-100"
          />
          <input
            type="password"
            name="apiSecret"
            placeholder="API Secret"
            value={newAccount.apiSecret}
            onChange={handleInputChange}
            className="p-2 rounded bg-gray-100"
          />
          <button
            onClick={addAccount}
            className="bg-blue-500 hover:bg-blue-500 text-white font-bold py-1 px-4 rounded"
          >
            添加账户
          </button>
        </div>
      </div>

      {/* Accounts List and Balances */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">账户</h2>
        </div>
        <div className="space-y-4">
          {users.map((user) => (
            <div key={user.name + user.apiKey} className="p-4 bg-gray-100 rounded-md flex justify-between items-center">
              <div>
                <div className="flex items-center">
                  <span className="font-bold mr-4">{user.name}</span>
                  <span>API Key: {user.apiKey.substring(0, 8)}...</span>
                </div>
                <p className="text-purple-600">Balance: {accountMap[user.name]?.totalWalletBalance || "N/A"}</p>
              </div>
              <button
                onClick={() => deleteUser(user.name)}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded"
              >
                删除
              </button>
            </div>
          ))}
          {users.length === 0 && <p>No accounts configured yet.</p>}
        </div>
      </div>
    </div>
  );
}
