/**
 * Community platform DB helpers.
 * Tables: community_messages (live chat), community_posts, community_comments.
 * All tables are auto-created on first use (self-bootstrapping).
 */

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

pool.on("error", (err) => {
  console.error("[community-db] Pool error:", err.message);
});

export async function ensureCommunityTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_messages (
        id          SERIAL       PRIMARY KEY,
        author      TEXT         NOT NULL,
        content     TEXT         NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS community_posts (
        id          SERIAL       PRIMARY KEY,
        author      TEXT         NOT NULL,
        title       TEXT         NOT NULL,
        content     TEXT         NOT NULL,
        upvotes     INTEGER      NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS community_comments (
        id          SERIAL       PRIMARY KEY,
        post_id     INTEGER      NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        author      TEXT         NOT NULL,
        content     TEXT         NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS community_profiles (
        address        TEXT        PRIMARY KEY,
        nickname       TEXT,
        address_public BOOLEAN     NOT NULL DEFAULT TRUE,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS community_comments_post_id_idx
        ON community_comments(post_id);

      CREATE TABLE IF NOT EXISTS community_votes (
        post_id        INTEGER  NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        voter_address  TEXT     NOT NULL,
        vote           SMALLINT NOT NULL,
        PRIMARY KEY (post_id, voter_address)
      );

      CREATE INDEX IF NOT EXISTS community_votes_voter_idx
        ON community_votes(voter_address);
    `);
  } catch (err) {
    console.error("[community-db] Could not ensure community tables:", (err as Error).message);
  }
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export interface Profile {
  address: string;
  nickname: string | null;
  addressPublic: boolean;
}

export async function getProfile(address: string): Promise<Profile | null> {
  const { rows } = await pool.query<{
    address: string; nickname: string | null; address_public: boolean;
  }>("SELECT address, nickname, address_public FROM community_profiles WHERE address = $1", [address.toLowerCase()]);
  if (!rows[0]) return null;
  return { address: rows[0].address, nickname: rows[0].nickname, addressPublic: rows[0].address_public };
}

export async function upsertProfile(
  address: string,
  nickname: string | null,
  addressPublic: boolean,
): Promise<Profile> {
  const addr = address.toLowerCase();
  const trimmed = nickname?.trim().slice(0, 32) || null;
  await pool.query(
    `INSERT INTO community_profiles (address, nickname, address_public, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (address) DO UPDATE
       SET nickname = EXCLUDED.nickname,
           address_public = EXCLUDED.address_public,
           updated_at = NOW()`,
    [addr, trimmed, addressPublic],
  );
  return { address: addr, nickname: trimmed, addressPublic };
}

/** Batch-fetch profiles for a list of addresses. Returns a map keyed by lowercase address. */
export async function getProfilesForAddresses(addresses: string[]): Promise<Map<string, Profile>> {
  if (addresses.length === 0) return new Map();
  const lower = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const { rows } = await pool.query<{
    address: string; nickname: string | null; address_public: boolean;
  }>(
    "SELECT address, nickname, address_public FROM community_profiles WHERE address = ANY($1)",
    [lower],
  );
  const map = new Map<string, Profile>();
  for (const r of rows) {
    map.set(r.address, { address: r.address, nickname: r.nickname, addressPublic: r.address_public });
  }
  return map;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  author: string;          // always the raw wallet address
  displayName: string;     // nickname if set, otherwise short address
  addressPublic: boolean;  // whether the sender chose to expose their address
  content: string;
  createdAt: string;
}

/** Deterministic Anon name derived from the address — same address → same name. */
function anonName(addr: string): string {
  // Use last 4 hex chars → 0–65535, map to 1000–9999
  const num = (parseInt(addr.slice(-4), 16) % 9000) + 1000;
  return `Anon${num}`;
}

function toMessage(
  r: { id: number; author: string; content: string; created_at: Date },
  profile: Profile | undefined,
): ChatMessage {
  return {
    id: r.id,
    author: r.author,
    displayName: profile?.nickname ?? anonName(r.author),
    addressPublic: profile?.addressPublic ?? true,
    content: r.content,
    createdAt: r.created_at.toISOString(),
  };
}

export async function getRecentMessages(limit = 80): Promise<ChatMessage[]> {
  const { rows } = await pool.query<{
    id: number; author: string; content: string; created_at: Date;
  }>(
    `SELECT id, author, content, created_at
     FROM community_messages
     ORDER BY id DESC
     LIMIT $1`,
    [limit],
  );
  const reversed = rows.reverse();
  const profiles = await getProfilesForAddresses(reversed.map((r) => r.author));
  return reversed.map((r) => toMessage(r, profiles.get(r.author)));
}

export async function insertMessage(author: string, content: string): Promise<ChatMessage> {
  const addr = author.toLowerCase();
  const { rows } = await pool.query<{
    id: number; author: string; content: string; created_at: Date;
  }>(
    `INSERT INTO community_messages (author, content)
     VALUES ($1, $2)
     RETURNING id, author, content, created_at`,
    [addr, content.trim()],
  );
  const r = rows[0]!;
  const profile = await getProfile(addr);
  return toMessage(r, profile ?? undefined);
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export interface Post {
  id: number;
  author: string;
  title: string;
  content: string;
  upvotes: number;
  commentCount: number;
  createdAt: string;
}

export async function listPosts(): Promise<Post[]> {
  const { rows } = await pool.query<{
    id: number; author: string; title: string; content: string;
    upvotes: number; comment_count: string; created_at: Date;
  }>(`
    SELECT p.id, p.author, p.title, p.content, p.upvotes,
           COUNT(c.id)::text AS comment_count, p.created_at
    FROM community_posts p
    LEFT JOIN community_comments c ON c.post_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id,
    author: r.author,
    title: r.title,
    content: r.content,
    upvotes: r.upvotes,
    commentCount: parseInt(r.comment_count, 10),
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getPost(id: number): Promise<Post | null> {
  const { rows } = await pool.query<{
    id: number; author: string; title: string; content: string;
    upvotes: number; comment_count: string; created_at: Date;
  }>(`
    SELECT p.id, p.author, p.title, p.content, p.upvotes,
           COUNT(c.id)::text AS comment_count, p.created_at
    FROM community_posts p
    LEFT JOIN community_comments c ON c.post_id = p.id
    WHERE p.id = $1
    GROUP BY p.id
  `, [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id, author: r.author, title: r.title, content: r.content,
    upvotes: r.upvotes, commentCount: parseInt(r.comment_count, 10),
    createdAt: r.created_at.toISOString(),
  };
}

export async function insertPost(author: string, title: string, content: string): Promise<Post> {
  const { rows } = await pool.query<{
    id: number; author: string; title: string; content: string;
    upvotes: number; created_at: Date;
  }>(
    `INSERT INTO community_posts (author, title, content)
     VALUES ($1, $2, $3)
     RETURNING id, author, title, content, upvotes, created_at`,
    [author.toLowerCase(), title.trim(), content.trim()],
  );
  const r = rows[0]!;
  return { id: r.id, author: r.author, title: r.title, content: r.content,
    upvotes: r.upvotes, commentCount: 0, createdAt: r.created_at.toISOString() };
}

/**
 * Cast or toggle a vote (+1 / -1) on a post.
 * Voting the same direction a second time removes the vote (toggle off).
 * Returns the new net score and the caller's resulting vote state.
 */
export async function votePost(
  postId: number,
  voterAddress: string,
  vote: 1 | -1,
): Promise<{ netScore: number; myVote: 1 | -1 | null }> {
  const addr = voterAddress.toLowerCase();

  const { rows: existing } = await pool.query<{ vote: number }>(
    "SELECT vote FROM community_votes WHERE post_id = $1 AND voter_address = $2",
    [postId, addr],
  );

  if (existing[0]?.vote === vote) {
    // Same direction again → toggle off
    await pool.query(
      "DELETE FROM community_votes WHERE post_id = $1 AND voter_address = $2",
      [postId, addr],
    );
  } else {
    // New vote or switching direction → upsert
    await pool.query(
      `INSERT INTO community_votes (post_id, voter_address, vote) VALUES ($1, $2, $3)
       ON CONFLICT (post_id, voter_address) DO UPDATE SET vote = EXCLUDED.vote`,
      [postId, addr, vote],
    );
  }

  // Recalculate net score and write back to posts table
  const { rows: scoreRows } = await pool.query<{ net: string }>(
    "SELECT COALESCE(SUM(vote), 0)::text AS net FROM community_votes WHERE post_id = $1",
    [postId],
  );
  const netScore = parseInt(scoreRows[0]?.net ?? "0", 10);
  await pool.query("UPDATE community_posts SET upvotes = $1 WHERE id = $2", [netScore, postId]);

  const { rows: voteRows } = await pool.query<{ vote: number }>(
    "SELECT vote FROM community_votes WHERE post_id = $1 AND voter_address = $2",
    [postId, addr],
  );
  const myVote = voteRows[0] ? (voteRows[0].vote as 1 | -1) : null;
  return { netScore, myVote };
}

/** Returns a map of postId → vote (1 | -1) for all posts this address has voted on. */
export async function getMyVotes(voterAddress: string): Promise<Map<number, 1 | -1>> {
  const { rows } = await pool.query<{ post_id: number; vote: number }>(
    "SELECT post_id, vote FROM community_votes WHERE voter_address = $1",
    [voterAddress.toLowerCase()],
  );
  const map = new Map<number, 1 | -1>();
  for (const r of rows) map.set(r.post_id, r.vote as 1 | -1);
  return map;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export interface Comment {
  id: number;
  postId: number;
  author: string;
  content: string;
  createdAt: string;
}

export async function getComments(postId: number): Promise<Comment[]> {
  const { rows } = await pool.query<{
    id: number; post_id: number; author: string; content: string; created_at: Date;
  }>(
    `SELECT id, post_id, author, content, created_at
     FROM community_comments
     WHERE post_id = $1
     ORDER BY id ASC`,
    [postId],
  );
  return rows.map((r) => ({
    id: r.id, postId: r.post_id, author: r.author,
    content: r.content, createdAt: r.created_at.toISOString(),
  }));
}

export async function insertComment(postId: number, author: string, content: string): Promise<Comment> {
  const { rows } = await pool.query<{
    id: number; post_id: number; author: string; content: string; created_at: Date;
  }>(
    `INSERT INTO community_comments (post_id, author, content)
     VALUES ($1, $2, $3)
     RETURNING id, post_id, author, content, created_at`,
    [postId, author.toLowerCase(), content.trim()],
  );
  const r = rows[0]!;
  return { id: r.id, postId: r.post_id, author: r.author,
    content: r.content, createdAt: r.created_at.toISOString() };
}
