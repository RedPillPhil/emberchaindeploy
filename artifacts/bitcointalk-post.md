# BitcoinTalk Post — Altcoin Mining Board

**Board:** Altcoin Discussion → Mining (Altcoins)
**Thread title:** [ANN][EMBR] 🔥 Emberchain — Keccak256 PoW | 5 EMBR | 8s Blocks | Proportional Pool | Browser Mining | Privacy Pool | P2P Escrow

---

## POST 1 — Original ANN (kept for reference)

```bbcode
[center][size=22pt][b][color=#FF6B35]🔥 EMBERCHAIN (EMBR)[/color][/b][/size]
[size=12pt][i]Mine from your browser. Share rewards proportionally. Shield your transactions. Trade peer-to-peer.[/i][/size][/center]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ WHAT IS EMBERCHAIN?[/color][/size][/b]

Emberchain (EMBR) is a mineable proof-of-work blockchain with a real EVM execution engine, a Monero-inspired shielded privacy pool, and a built-in peer-to-peer escrow exchange — all from a single browser-based wallet. No Rust node. No GPU drivers. Mine directly from the UI, or run a standalone script for maximum hash rate.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ CHAIN SPECIFICATIONS[/color][/size][/b]

[table]
[tr][td][b]Name[/b][/td][td]Emberchain[/td][/tr]
[tr][td][b]Ticker[/b][/td][td]EMBR[/td][/tr]
[tr][td][b]Algorithm[/b][/td][td]Keccak256 (CPU-friendly PoW)[/td][/tr]
[tr][td][b]Block Reward[/b][/td][td]5 EMBR per block[/td][/tr]
[tr][td][b]Target Block Time[/b][/td][td]8 seconds[/td][/tr]
[tr][td][b]Difficulty Adjustment[/b][/td][td]Every block — ±25% nudge toward 8s target[/td][/tr]
[tr][td][b]Supply[/b][/td][td]Fully mined — no premine, no ICO, no dev fund[/td][/tr]
[tr][td][b]Chain ID[/b][/td][td]7773 (0x1e5d)[/td][/tr]
[tr][td][b]Address Format[/b][/td][td]Standard 0x Ethereum-style (secp256k1)[/td][/tr]
[tr][td][b]EVM Compatible[/b][/td][td]Yes — real EthereumJS EVM (Cancun hardfork opcodes)[/td][/tr]
[tr][td][b]Smart Contracts[/b][/td][td]Fully supported — deploy and call from wallet UI[/td][/tr]
[/table]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ ADD TO METAMASK / EVM WALLET[/color][/size][/b]

Emberchain speaks standard Ethereum JSON-RPC. Any EVM wallet connects natively.

[code]
Network Name  : Emberchain
RPC URL       : https://<your-node-url>/api/rpc
Chain ID      : 7773
Currency      : EMBR
Block Explorer: https://<your-node-url>/ledger
[/code]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ MINING — HOW IT WORKS[/color][/size][/b]

[b]Algorithm: Keccak256 PoW[/b]

Find a nonce such that:

[code]keccak256(JSON.stringify({ number, parentHash, miner, timestamp, difficulty, transactionsRoot, nonce })) ≤ target[/code]

Where [b]target = (2^256 − 1) / difficulty[/b]. No SHA3 padding, no DAG, no VRAM — pure CPU work accessible to anyone with a browser or a script.

[b]Difficulty Retargeting[/b]

Adjusts every single block. Clamped at ±25% per block to prevent swings. The chain self-stabilizes around 8 seconds.

[b]Three API calls is all it takes:[/b]

[code]GET  /api/mining/template?minerAddress=0xYOUR_ADDRESS   → get work
POST /api/mining/share                                    → submit a partial share
POST /api/mining/submit                                   → submit a winning block[/code]

No stratum. No proprietary protocol. A complete external miner fits in under 50 lines.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ PROPORTIONAL SHARE-BASED PAYOUTS — LIVE[/color][/size][/b]

Block rewards are [b]not[/b] winner-takes-all. Every miner who submitted a valid share during the round earns a cut proportional to their share count when the block lands — whether or not they found the winning nonce.

[b]How shares work:[/b]

The template response includes two targets:
[list]
[li][b]target[/b] — full block difficulty. Hit this and you win the block.[/li]
[li][b]shareTarget[/b] — 256× easier (target × 256). Hit this and you bank a share.[/li]
[/list]

At current difficulty you can expect roughly [b]256 shares per block[/b] on average. Every share earns you a fraction of the 5 EMBR block reward proportional to your contribution.

[b]What this means in practice:[/b]
[list]
[li]Small miners earn steadily rather than going long stretches with nothing[/li]
[li]No external pool operator — the pool lives inside the chain engine itself[/li]
[li]No pool fee — 100% of the block reward goes to miners, split by shares[/li]
[li]Payout breakdown for every block is visible in the block explorer[/li]
[/list]

[b]Share submission is handled automatically[/b] by the browser miner. External scripts just need to POST to [b]/api/mining/share[/b] whenever a hash meets [b]shareTarget[/b].

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ BROWSER MINING — ZERO SETUP[/color][/size][/b]

Open the wallet → click [b]Mining[/b] → paste your address → click [b]Start Mining[/b]. Your CPU starts hashing immediately in a background WebWorker.

[b]Live stats shown:[/b]
[list]
[li]Hash rate (H/s)[/li]
[li]Shares submitted this round[/li]
[li]Your estimated payout cut (%)[/li]
[li]Blocks found this session[/li]
[li]Running EMBR balance[/li]
[/list]

No drivers. No software. Works on any desktop browser. Tab enforcement prevents double-mining from the same device.

[i]Browser mining is the easiest way to start, but for maximum hash rate run the standalone script below — native C keccak256 is roughly 3–5× faster than JavaScript.[/i]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ EXTERNAL MINER — PYTHON SCRIPT (UNDER 50 LINES)[/color][/size][/b]

Native keccak256 via pycryptodome. Submits shares automatically. Faster than browser mining.

[code]
#!/usr/bin/env python3
"""Emberchain CPU miner with proportional share pool support."""
import json, time, random, requests
from Crypto.Hash import keccak

NODE   = "https://<your-node-url>"
WALLET = "0xYOUR_EMBR_ADDRESS"

def keccak256(data: bytes) -> int:
    k = keccak.new(digest_bits=256)
    k.update(data)
    return int.from_bytes(k.digest(), "big")

def encode(hdr: dict, nonce: int) -> bytes:
    return json.dumps({**hdr, "nonce": str(nonce)}, separators=(",", ":")).encode()

def mine():
    while True:
        t = requests.get(f"{NODE}/api/mining/template?minerAddress={WALLET}").json()
        block_target = int(t["target"])
        share_target = int(t["shareTarget"])
        hdr = t["header"]
        nonce, hashes, start = random.randint(0, 2**48), 0, time.time()

        while True:
            h = keccak256(encode(hdr, nonce))

            if h <= block_target:
                r = requests.post(f"{NODE}/api/mining/submit", json={
                    "minerAddress": WALLET, "header": hdr,
                    "nonce": str(nonce),
                    "blockHash": "0x" + h.to_bytes(32, "big").hex(),
                    "pendingTxHashes": t["pendingTxHashes"],
                })
                print(f"✓ Block #{hdr['number']}  status={r.status_code}")
                break

            if h <= share_target:
                requests.post(f"{NODE}/api/mining/share",
                    json={"minerAddress": WALLET, "header": hdr, "nonce": str(nonce)},
                    timeout=2)
                print(f"  share nonce={nonce}")

            nonce += 1; hashes += 1
            if hashes % 10_000 == 0:
                print(f"  {hashes/(time.time()-start):.0f} H/s  diff={hdr['difficulty']}")
                break  # refresh template each 10k hashes

if __name__ == "__main__":
    mine()
[/code]

[b]Install:[/b]
[code]pip install requests pycryptodome[/code]

[i]Tip: run multiple instances for multi-core mining. Each instance uses one CPU core. Each submits its own shares and earns its own proportional cut.[/i]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ PRIVACY — MONERO-STYLE SHIELDED POOL[/color][/size][/b]

Emberchain includes a full shielded transaction pool inspired by Monero's cryptographic primitives. Public EMBR can be shielded, transferred privately, and unshielded back — sender, recipient, and amount all hidden during the private leg.

[b]Four cryptographic layers:[/b]

[b]1. Stealth Addresses (ECDH one-time keys)[/b]
Each private note is sent to a one-time address derived from an ECDH shared secret. No two payments to the same recipient produce the same on-chain address. Only the recipient's spend key can find and claim the note.

[b]2. Pedersen Commitments (amount hiding)[/b]
Amounts are never stored in plaintext. Each note carries [i]C = v·G + r·H[/i]. The chain verifies inputs equal outputs + fee without learning any individual value.

[b]3. LSAG Linkable Ring Signatures (sender anonymity)[/b]
Spending a note includes decoy unspent notes from the pool in an LSAG ring (same construction as Monero). Verifiers confirm one ring member authorized the spend without knowing which one.

[b]4. Key Images (double-spend prevention)[/b]
Each spend produces a unique key image. The chain rejects any attempt to re-spend a note — without revealing which note the image corresponds to.

[b]Honest limitations:[/b]
[list]
[li]No Bulletproofs yet — amount non-negativity enforced by the node operator. ZK range proofs are on the roadmap.[/li]
[li]Shield/unshield boundaries are visible (same design as Zcash t→z).[/li]
[li]Anonymity set grows with usage — early rings are small, like early Monero.[/li]
[/list]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ IN-APP P2P ESCROW EXCHANGE[/color][/size][/b]

Sellers lock EMBR into on-chain escrow and name a price. Buyers pay externally. The chain verifies the payment on-chain before releasing EMBR automatically — no intermediary, no KYC.

[b]Supported payment currencies:[/b]
[list]
[li][b]ETH[/b] — Ethereum mainnet (Etherscan, 12 confirmations)[/li]
[li][b]USDT[/b] — ERC-20, TRC-20, BEP-20, Polygon (128 confirmations)[/li]
[li][b]BTC[/b] — Bitcoin mainnet (Blockstream.info, 2 confirmations)[/li]
[li][b]SOL[/b] — Solana mainnet (public RPC, finalized state)[/li]
[/list]

[b]Trade flow:[/b]
[list=1]
[li]Seller creates listing — EMBR locked in escrow instantly[/li]
[li]Buyer reserves listing — 15-minute exclusive window[/li]
[li]Buyer pays externally to seller's address[/li]
[li]Buyer submits tx hash — chain fetches and verifies on the external explorer[/li]
[li]EMBR released automatically on confirmation[/li]
[/list]

Replay protection enforced at chain level — each external tx hash fulfills exactly one listing, forever.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ WALLET FEATURES[/color][/size][/b]

[list]
[li]Create or import wallets — private key shown once, never stored server-side[/li]
[li]Encrypted keystore file backup and restore[/li]
[li]Send public EMBR transactions[/li]
[li]Deploy EVM smart contracts from the browser[/li]
[li]Shield EMBR → private pool / send privately / unshield back[/li]
[li]Browser mining with live hash rate, share count, and estimated payout %[/li]
[li]P2P exchange — list, reserve, buy, cancel with multi-chain payment verification[/li]
[li]Full transaction and block explorer (with per-block payout breakdowns)[/li]
[li]Price history chart from fulfilled exchange trades[/li]
[li]MetaMask / EVM wallet connection via JSON-RPC[/li]
[/list]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ TECHNICAL STACK[/color][/size][/b]

[list]
[li][b]Consensus:[/b] Custom Keccak256 PoW, per-block difficulty adjustment[/li]
[li][b]EVM:[/b] EthereumJS — Cancun hardfork, full opcode support[/li]
[li][b]Cryptography:[/b] ethereum-cryptography (secp256k1, keccak256), @noble/curves (privacy primitives)[/li]
[li][b]State:[/b] EthereumJS SimpleStateManager, persisted as JSON + PostgreSQL backup[/li]
[li][b]API:[/b] Express 5 REST + Ethereum JSON-RPC 2.0[/li]
[li][b]Runtime:[/b] Node.js 24, TypeScript 5.9[/li]
[li][b]Frontend:[/b] React + Vite + TanStack Query[/li]
[/list]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ ROADMAP[/color][/size][/b]

[list]
[✓] Keccak256 PoW with per-block difficulty adjustment
[✓] Browser-based WebWorker miner with live hash rate
[✓] EVM smart contract deployment and execution
[✓] Monero-style shielded pool (stealth, commitments, LSAG rings, key images)
[✓] P2P escrow exchange (ETH, BTC, SOL, USDT multi-chain)
[✓] Listing reservation system (15-min buyer lock)
[✓] MetaMask / EVM wallet RPC endpoint
[✓] Proportional share-based mining pool — live
[✓] Encrypted wallet backup and keystore restore
[ ] Multi-instance mining script (Rust / Go for maximum H/s)
[ ] Bulletproofs / ZK range proofs for trustless amount privacy
[ ] Multi-node peer discovery
[/list]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ NO PREMINE. NO ICO. NO DEV TAX.[/color][/size][/b]

[center][i]Every EMBR in existence was mined. If you want some, run a miner.[/i][/center]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[center][b]Mining reports, hash rate benchmarks, share pool questions, and script modifications welcome below.[/b][/center]
```

---

## POST 2 — Development Update (July 2026)

```bbcode
[center][size=18pt][b][color=#FF6B35]🔥 EMBERCHAIN — MAJOR UPDATE[/color][/b][/size]
[size=11pt][i]Bridge to Base mainnet. WrappedEMBR on Base. EmberSwap live. Full contract explorer.[/i][/size][/center]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ WHAT'S NEW[/color][/size][/b]

A lot has shipped since the first post. Here's a full accounting of everything that's gone live.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=13pt][color=#FF6B35]🌉 EMBR ↔ BASE BRIDGE — LIVE ON BASE MAINNET[/color][/size][/b]

EMBR is now bridgeable to Base (Coinbase's L2). Three contracts are deployed and verified on Base mainnet:

[table]
[tr][td][b]Contract[/b][/td][td][b]Address (Base mainnet)[/b][/td][td][b]Purpose[/b][/td][/tr]
[tr][td][b]WrappedEMBR (wEMBR)[/b][/td][td][font=Courier]0x9362587019Ea0e4ef90fbd981c615d4441D9D2c4[/font][/td][td]ERC-20 representation of EMBR on Base[/td][/tr]
[tr][td][b]EmberchainBridge[/b][/td][td][font=Courier]0x1573EdF8F933601e6f37AC9B104cF62C7f85a0F4[/font][/td][td]Locks wEMBR on Base, triggers release on EMBR chain[/td][/tr]
[tr][td][b]EmberSwap[/b][/td][td][font=Courier]0x4e8821099cC706d9C4e6E7C05923C2950E361459[/font][/td][td]Swap router wrapping Uniswap V2[/td][/tr]
[/table]

[b]How the bridge works:[/b]
[list=1]
[li]Call [b]lockEMBR(amount, nonce)[/b] on the EmberBridge contract on the EMBR chain[/li]
[li]A relayer watches for this event and calls [b]bridgeIn(recipient, amount, nonce)[/b] on the EmberchainBridge on Base[/li]
[li]WrappedEMBR (wEMBR) is minted 1:1 to the recipient on Base[/li]
[li]To bridge back: call [b]bridgeOut(amount, nonce)[/b] on the EmberchainBridge — wEMBR is burned, the relayer calls [b]releaseEMBR[/b] on the EMBR chain[/li]
[/list]

The bridge is trustless on the accounting side — all mint/burn events are tied to unique nonces. A given nonce can never be processed twice. The relayer is the only trust assumption, and it signs nothing — it only relays observed events.

[b]Bridge contract source is fully open. ABI and addresses above.[/b]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=13pt][color=#FF6B35]🔁 EMBERSWAP — PROTOCOL-OWNED LIQUIDITY ACCUMULATOR[/color][/size][/b]

EmberSwap is a thin wrapper over Uniswap V2 on Base that charges a [b]0.25% protocol fee on every swap[/b]. That fee is automatically converted to ETH and added as liquidity to the wEMBR/ETH Uniswap V2 pool — deepening the pool with every trade.

[b]Key mechanics:[/b]
[list]
[li]All three swap directions supported: token→token, ETH→token, token→ETH[/li]
[li]0.25% fee taken from every swap — zero manual intervention needed[/li]
[li]Fee accumulates until it hits the auto-liquidity threshold (0.01 ETH), then half buys wEMBR and the pair is added to Uniswap V2[/li]
[li]LP tokens go to the EmberSwap contract itself — permanently protocol-owned. They are never withdrawn.[/li]
[li]Every swap logs your address and volume — eligible for a future EMBR airdrop[/li]
[/list]

[b]The pool gets deeper every time someone swaps. No token team involvement after deployment.[/b]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=13pt][color=#FF6B35]🔍 ETHERSCAN-STYLE CONTRACT EXPLORER[/color][/size][/b]

The chain explorer now has full Etherscan-style contract pages. Navigate to any contract address in the wallet and you get:

[b]Contract detail page:[/b]
[list]
[li]Bytecode size, creator address, creator transaction, deployment timestamp[/li]
[li][b]Verified / Unverified badge[/b] — green if ABI is registered, amber if not[/li]
[li][b]Read Contract tab[/b] — call any view/pure function directly from the browser, no wallet needed[/li]
[li][b]Write Contract tab[/b] — send transactions to any non-payable or payable function using your connected wallet[/li]
[li][b]ABI verification form[/b] — paste your ABI JSON array to unlock Read/Write instantly. No compilation step, no source upload. Just the ABI.[/li]
[/list]

[b]Token detail page (for ERC-20 contracts):[/b]
[list]
[li]Auto-detected from ERC-20 interface — name, symbol, decimals, total supply[/li]
[li]Live holder list with balances and percentage of supply[/li]
[li]Read/Write contract tabs same as above[/li]
[/list]

This works for any contract deployed on the EMBR chain, not just system contracts.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=13pt][color=#FF6B35]📜 TRANSACTION CALLDATA DECODER[/color][/size][/b]

Transaction detail pages now decode calldata automatically. Instead of showing raw hex, known function calls are displayed as named parameters:

[table]
[tr][td][b]Function[/b][/td][td][b]Selector[/b][/td][td][b]Decoded[/b][/td][/tr]
[tr][td]releaseEMBR[/td][td]0x4b86ca03[/td][td]recipient (address), amount (uint256), nonce (uint256)[/td][/tr]
[tr][td]lockEMBR[/td][td]0x7ea803f0[/td][td]nonce (uint256), recipient (address)[/td][/tr]
[tr][td]bridgeIn[/td][td]0x80e125a6[/td][td]recipient (address), amount (uint256), nonce (uint256)[/td][/tr]
[tr][td]ERC-20 transfer[/td][td]0xa9059cbb[/td][td]to (address), value (uint256)[/td][/tr]
[tr][td]ERC-20 approve[/td][td]0x095ea7b3[/td][td]spender (address), value (uint256)[/td][/tr]
[/table]

Addresses in decoded output are clickable links to the wallet explorer. Unknown selectors fall back to raw hex. The decoder is pure client-side TypeScript — no backend call needed.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=13pt][color=#FF6B35]🔧 EVM STABILITY — EIP-2200 REFUND BUG FIXED[/color][/size][/b]

A subtle EVM-level bug was fixed that caused certain multi-transaction blocks to fail with "refund exhausted". The root cause: EthereumJS's storage cache wasn't being cleared between transactions in the same block. When one transaction drained a storage slot to zero and a subsequent transaction in the same block wrote to it again, the EIP-2200 gas accounting saw the wrong "original" value and tried to apply a gas refund on a zero counter — crashing the block.

The fix: explicitly clear the original storage cache at each transaction boundary, exactly as mainnet Ethereum clients do.

This was most visible in bridge operations where [b]releaseEMBR[/b] (draining [i]totalLocked[/i]) and [b]lockEMBR[/b] (incrementing [i]totalLocked[/i]) could land in the same block.

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=13pt][color=#FF6B35]📊 UPDATED ROADMAP[/color][/size][/b]

[list]
[✓] Keccak256 PoW with per-block difficulty adjustment
[✓] Browser-based WebWorker miner with live hash rate
[✓] Proportional share-based mining pool — zero pool fee
[✓] EVM smart contract deployment and execution
[✓] Monero-style shielded pool (stealth, Pedersen commitments, LSAG rings, key images)
[✓] P2P escrow exchange (ETH, BTC, SOL, USDT multi-chain)
[✓] Listing reservation system (15-min buyer lock)
[✓] MetaMask / EVM wallet JSON-RPC endpoint
[✓] Encrypted wallet backup and keystore restore
[✓] [b]EMBR ↔ Base bridge — live on Base mainnet[/b]
[✓] [b]WrappedEMBR (wEMBR) ERC-20 on Base mainnet[/b]
[✓] [b]EmberSwap — protocol-owned auto-liquidity on Uniswap V2[/b]
[✓] [b]Etherscan-style contract explorer with ABI verification[/b]
[✓] [b]Token pages with live holder list and Read/Write contract tabs[/b]
[✓] [b]Transaction calldata decoder[/b]
[✓] [b]EIP-2200 multi-tx block stability fix[/b]
[ ] Bulletproofs / ZK range proofs for trustless amount privacy
[ ] Mining pool leaderboard
[ ] Multi-node peer discovery
[/list]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[b][size=14pt][color=#FF6B35]▌ NO PREMINE. NO ICO. NO DEV TAX.[/color][/size][/b]

[center][i]Every EMBR in existence was mined. If you want some, run a miner.[/i][/center]
[center][i]The bridge, the swap, the explorer — all open source, all on-chain.[/i][/center]

[center]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/center]

[center][b]Questions about the bridge, swap addresses, or the new explorer below.[/b][/center]
```
