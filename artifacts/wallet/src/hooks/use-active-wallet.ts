import { useState, useEffect } from 'react';

export interface ActiveWallet {
  address: string;
  privateKey: string;
}

const WALLET_KEY = 'emberchain_active_wallet';

export function useActiveWallet() {
  const [activeWallet, setActiveWalletState] = useState<ActiveWallet | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(WALLET_KEY);
      if (stored) {
        setActiveWalletState(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to parse active wallet from localStorage', err);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const setActiveWallet = (wallet: ActiveWallet | null) => {
    if (wallet) {
      localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
    } else {
      localStorage.removeItem(WALLET_KEY);
    }
    setActiveWalletState(wallet);
    // Dispatch custom event to notify other components in same window
    window.dispatchEvent(new Event('wallet-changed'));
  };

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const stored = localStorage.getItem(WALLET_KEY);
        setActiveWalletState(stored ? JSON.parse(stored) : null);
      } catch (err) {
        // ignore
      }
    };

    window.addEventListener('wallet-changed', handleStorageChange);
    return () => window.removeEventListener('wallet-changed', handleStorageChange);
  }, []);

  return { activeWallet, setActiveWallet, isLoaded };
}
