/**
 * Community platform — REST routes + WebSocket broadcaster.
 *
 * REST:
 *   GET  /community/posts                  — list posts
 *   POST /community/posts                  — create post { author, title, content }
 *   GET  /community/posts/:id              — post + comments
 *   POST /community/posts/:id/comments     — add comment { author, content }
 *   POST /community/posts/:id/upvote       — increment upvotes
 *   GET  /community/profile/:address       — get profile
 *   PUT  /community/profile                — upsert profile { address, nickname, addressPublic }
 *
 * WebSocket: /api/community/ws
 *   Client → server:  { type:"chat", author, content }
 *                     { type:"comment", author, postId, content }
 *   Server → client:  { type:"history", messages }         (on connect)
 *                     { type:"chat_message", message }     (broadcast)
 *                     { type:"new_comment", comment }      (broadcast)
 *                     { type:"new_post", post }            (broadcast)
 *                     { type:"post_upvoted", postId, upvotes } (broadcast)
 *                     { type:"profile_updated", address, displayName, addressPublic } (broadcast)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import type { WebSocketServer, WebSocket } from "ws";
import {
  getRecentMessages,
  insertMessage,
  listPosts,
  getPost,
  insertPost,
  votePost,
  getMyVotes,
  getComments,
  insertComment,
  getProfile,
  upsertProfile,
} from "../lib/community-db";

const router: IRouter = Router();

// ── REST ──────────────────────────────────────────────────────────────────────

router.get("/community/posts", async (_req: Request, res: Response): Promise<void> => {
  try { res.json(await listPosts()); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post("/community/posts", async (req: Request, res: Response): Promise<void> => {
  const { author, title, content } = req.body ?? {};
  if (!author || !title || !content) {
    res.status(400).json({ error: "author, title, and content are required" }); return;
  }
  try {
    const post = await insertPost(author, title, content);
    broadcast({ type: "new_post", post });
    res.status(201).json(post);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get("/community/posts/:id", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }
  try {
    const [post, comments] = await Promise.all([getPost(id), getComments(id)]);
    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    res.json({ ...post, comments });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post("/community/posts/:id/comments", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }
  const { author, content } = req.body ?? {};
  if (!author || !content) { res.status(400).json({ error: "author and content are required" }); return; }
  try {
    const comment = await insertComment(id, author, content);
    broadcast({ type: "new_comment", comment });
    res.status(201).json(comment);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post("/community/posts/:id/vote", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }
  const { address, vote } = req.body ?? {};
  if (!address || (vote !== 1 && vote !== -1)) {
    res.status(400).json({ error: "address and vote (1 or -1) are required" }); return;
  }
  try {
    const { netScore, myVote } = await votePost(id, address, vote as 1 | -1);
    broadcast({ type: "post_upvoted", postId: id, upvotes: netScore });
    res.json({ upvotes: netScore, myVote });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get("/community/my-votes", async (req: Request, res: Response): Promise<void> => {
  const address = req.query["address"] as string | undefined;
  if (!address) { res.status(400).json({ error: "address query param required" }); return; }
  try {
    const votes = await getMyVotes(address);
    res.json(Object.fromEntries(votes));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Profile ───────────────────────────────────────────────────────────────────

router.get("/community/profile/:address", async (req: Request<{ address: string }>, res: Response): Promise<void> => {
  try {
    const profile = await getProfile(req.params.address);
    if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
    res.json(profile);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.put("/community/profile", async (req: Request, res: Response): Promise<void> => {
  const { address, nickname, addressPublic } = req.body ?? {};
  if (!address) { res.status(400).json({ error: "address is required" }); return; }
  try {
    const profile = await upsertProfile(
      address,
      typeof nickname === "string" ? nickname : null,
      addressPublic !== false,
    );
    // Broadcast so live UIs can update displayed names immediately
    broadcast({
      type: "profile_updated",
      address: profile.address,
      displayName: profile.nickname ?? shortAddr(profile.address),
      addressPublic: profile.addressPublic,
    });
    res.json(profile);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

const clients = new Set<WebSocket>();

function broadcast(payload: unknown): void {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg);
  }
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function setupCommunityWS(wss: WebSocketServer): void {
  wss.on("connection", async (ws: WebSocket) => {
    clients.add(ws);

    // Send recent chat history (with display names already resolved)
    try {
      const messages = await getRecentMessages(80);
      ws.send(JSON.stringify({ type: "history", messages }));
    } catch { /* non-fatal */ }

    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          type: string;
          author?: string;
          content?: string;
          postId?: number;
        };

        if (data.type === "chat" && data.author && data.content) {
          const trimmed = data.content.trim().slice(0, 2000);
          if (!trimmed) return;
          const message = await insertMessage(data.author, trimmed);
          broadcast({ type: "chat_message", message });
        }

        if (data.type === "comment" && data.author && data.content && data.postId) {
          const trimmed = data.content.trim().slice(0, 4000);
          if (!trimmed) return;
          const comment = await insertComment(data.postId, data.author, trimmed);
          broadcast({ type: "new_comment", comment });
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });
}

export default router;
