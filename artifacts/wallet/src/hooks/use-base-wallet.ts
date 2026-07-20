/**
 * useBaseWallet — injected provider (MetaMask) connection hook for Base chain.
 *
 * Handles: connect, account/chain change listeners, network switch to Base
 * Sepolia (84532) or Base Mainnet (8453).
 */
import { useState, useEffect, useCallback } from "react";

// Minimal EIP-1193 provider type (MetaMask / injected wallets).
interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// Default to Base Sepolia (testnet). Override with VITE_BASE_CHAIN_ID.
const TARGET_CHAIN_ID_INT: number = parseInt(
  import.meta.env.VITE_BASE_CHAIN_ID ?? "84532",
  10,
);
const TARGET_CHAIN_HEX = "0x" + TARGET_CHAIN_ID_INT.toString(16);

const BASE_CHAIN_PARAMS =
  TARGET_CHAIN_ID_INT === 8453
    ? {
        chainId: TARGET_CHAIN_HEX,
        chainName: "Base",
        rpcUrls: ["https://mainnet.base.org"],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrls: ["https://basescan.org"],
      }
    : {
        chainId: TARGET_CHAIN_HEX,
        chainName: "Base Sepolia",
        rpcUrls: ["https://sepolia.base.org"],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrls: ["https://sepolia-explorer.base.org"],
      };

export interface BaseWallet {
  address: string;
  chainId: number;
}

export function useBaseWallet() {
  const [wallet, setWallet] = useState<BaseWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMetaMask =
    typeof window !== "undefined" && !!window.ethereum;

  const refreshState = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const [accounts, chainIdHex] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
        window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
      ]);
      if (accounts[0]) {
        setWallet({
          address: accounts[0],
          chainId: parseInt(chainIdHex, 16),
        });
      } else {
        setWallet(null);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshState();
    const eth = window.ethereum;
    if (!eth) return;
    eth.on("accountsChanged", refreshState);
    eth.on("chainChanged", refreshState);
    return () => {
      eth.removeListener("accountsChanged", refreshState);
      eth.removeListener("chainChanged", refreshState);
    };
  }, [refreshState]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask (or compatible wallet) not detected in this browser.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainIdHex = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      setWallet({ address: accounts[0], chainId: parseInt(chainIdHex, 16) });
    } catch (err) {
      setError((err as Error).message ?? "Connection rejected");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchToBase = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_HEX }],
      });
    } catch (err: unknown) {
      // 4902 = chain not added
      if ((err as { code?: number }).code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [BASE_CHAIN_PARAMS],
        });
      }
    }
  }, []);

  /**
   * Low-level eth_call via the injected provider.
   * Returns the raw hex result string.
   */
  const ethCall = useCallback(
    async (to: string, data: string): Promise<string> => {
      if (!window.ethereum) throw new Error("No provider");
      return window.ethereum.request({
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }) as Promise<string>;
    },
    [],
  );

  /**
   * Send a transaction via MetaMask and return the tx hash.
   */
  const sendTx = useCallback(
    async (params: {
      to: string;
      data: string;
      value?: string;
      from?: string;
    }): Promise<string> => {
      if (!window.ethereum) throw new Error("No provider");
      if (!wallet) throw new Error("Wallet not connected");
      return window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: params.from ?? wallet.address,
            to: params.to,
            data: params.data,
            value: params.value ?? "0x0",
          },
        ],
      }) as Promise<string>;
    },
    [wallet],
  );

  return {
    wallet,
    isConnecting,
    error,
    hasMetaMask,
    connect,
    switchToBase,
    ethCall,
    sendTx,
    isOnBase: wallet?.chainId === TARGET_CHAIN_ID_INT,
    targetChainId: TARGET_CHAIN_ID_INT,
  };
}
