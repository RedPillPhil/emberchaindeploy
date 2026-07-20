import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatEmbr(value: string | number): string {
  if (!value) return "0.00";
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  // EMBR has 18 decimals, similar to ETH
  const formatted = numValue / 1e18;
  return formatted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function formatHash(hash: string, chars = 6): string {
  if (!hash) return "";
  if (hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

export function formatAddress(address: string, chars = 6): string {
  return formatHash(address, chars);
}
