import React, { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "@/components/layout/shell";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  FileText,
  Send,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  Loader2,
  Users,
  Hash,
  Settings,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  author: string;
  displayName: string;
  addressPublic: boolean;
  content: string;
  createdAt: string;
}

interface Comment {
  id: number;
  postId: number;
  author: string;
  content: string;
  createdAt: string;
}

interface Post {
  id: number;
  author: string;
  title: string;
  content: string;
  upvotes: number;
  commentCount: number;
  createdAt: string;
  comments?: Comment[];
}

interface Profile {
  address: string;
  nickname: string | null;
  addressPublic: boolean;
}

type DisplayCache = Map<string, { displayName: string; addressPublic: boolean }>;

// ── helpers ───────────────────────────────────────────────────────────────────

/** Deterministic Anon name — mirrors server logic, same address always same name. */
function anonName(addr: string): string {
  if (!addr) return "Anon0000";
  const num = (parseInt(addr.slice(-4), 16) % 9000) + 1000;
  return `Anon${num}`;
}

function shortAddr(addr: string): string {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/community/ws`;
}

const BASE = "/api/community";

// ── Author chip with hover tooltip ───────────────────────────────────────────

function AuthorChip({
  displayName,
  author,
  addressPublic,
  isMe,
}: {
  displayName: string;
  author: string;
  addressPublic: boolean;
  isMe: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <span className="relative inline-block">
      <span
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
          "text-[10px] font-bold uppercase tracking-widest font-mono cursor-default select-none",
          isMe ? "text-primary/80" : "text-primary/70",
        )}
      >
        {displayName}
      </span>

      {hover && (
        <span
          className={cn(
            "absolute bottom-full left-0 mb-2 z-50 whitespace-nowrap",
            "rounded-sm border px-2.5 py-1.5 text-[10px] font-mono font-bold leading-none",
            "pointer-events-none select-none shadow-xl",
            addressPublic
              ? "bg-card border-border text-foreground"
              : "bg-card border-primary/20 text-primary/50",
          )}
        >
          {addressPublic ? (
            <>
              <span className="text-muted-foreground mr-1.5 font-sans normal-case tracking-normal font-normal">addr</span>
              {author}
            </>
          ) : (
            <span className="flex items-center gap-1.5 tracking-widest text-primary/50">
              <EyeOff className="w-2.5 h-2.5 inline-block" />
              ░░ SHIELDED ░░
            </span>
          )}
          {/* caret */}
          <span className={cn(
            "absolute top-full left-4 border-l-[4px] border-l-transparent",
            "border-r-[4px] border-r-transparent border-t-[5px]",
            addressPublic ? "border-t-border" : "border-t-primary/20",
          )} />
        </span>
      )}
    </span>
  );
}

// ── Profile settings panel ────────────────────────────────────────────────────

function ProfilePanel({
  address,
  onClose,
  onSaved,
}: {
  address: string;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [addressPublic, setAddressPublic] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/profile/${address}`)
      .then((r) => (r.ok ? r.json() as Promise<Profile> : null))
      .then((p) => {
        if (p) { setNickname(p.nickname ?? ""); setAddressPublic(p.addressPublic); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, nickname: nickname.trim() || null, addressPublic }),
      });
      if (res.ok) {
        const p = await res.json() as Profile;
        setSaved(true);
        onSaved(p);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <div className="absolute top-full right-0 mt-2 z-50 w-80">
      <div className="bg-card border border-border rounded-sm shadow-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Identity Settings</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nickname</label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 32))}
                placeholder={anonName(address)}
                className="bg-secondary/40 border-border text-sm h-8"
                maxLength={32}
              />
              <p className="text-[10px] text-muted-foreground/60">
                Leave blank to appear as <span className="font-mono">{anonName(address)}</span>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Address visibility</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddressPublic(true)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-sm border text-xs font-bold uppercase tracking-wide transition-all",
                    addressPublic ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:border-border/80",
                  )}
                >
                  <Eye className="w-3.5 h-3.5" /> Public
                </button>
                <button
                  onClick={() => setAddressPublic(false)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-sm border text-xs font-bold uppercase tracking-wide transition-all",
                    !addressPublic ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:border-border/80",
                  )}
                >
                  <EyeOff className="w-3.5 h-3.5" /> Shield
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/60">
                {addressPublic
                  ? "Others can hover your name to see your full address."
                  : "Others see ░░ SHIELDED ░░ when they hover your name."}
              </p>
            </div>

            <Button onClick={handleSave} disabled={saving} size="sm" className="w-full gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
              {saved ? "Saved!" : "Save identity"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── WebSocket hook ────────────────────────────────────────────────────────────

type WsEvent =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "chat_message"; message: ChatMessage }
  | { type: "new_comment"; comment: Comment }
  | { type: "new_post"; post: Post }
  | { type: "post_upvoted"; postId: number; upvotes: number }
  | { type: "profile_updated"; address: string; displayName: string; addressPublic: boolean };

function useWs(onEvent: (e: WsEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    function connect() {
      ws = new WebSocket(getWsUrl());
      wsRef.current = ws;
      ws.onopen = () => setOnline(true);
      ws.onclose = () => { setOnline(false); retryTimer = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try { onEventRef.current(JSON.parse(e.data as string) as WsEvent); } catch { /* ignore */ }
      };
    }
    connect();
    return () => { retryTimer && clearTimeout(retryTimer); ws.onclose = null; ws.close(); };
  }, []);

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(payload));
  }, []);

  return { send, online };
}

// ── Live Chat ─────────────────────────────────────────────────────────────────

function LiveChat({
  address, messages, displayCache, onSend, online,
}: {
  address: string;
  messages: ChatMessage[];
  displayCache: DisplayCache;
  onSend: (content: string) => void;
  online: boolean;
}) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-1 p-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground/50 text-sm italic py-8">
            No messages yet — say something!
          </div>
        )}
        {messages.map((m) => {
          const isMe = m.author.toLowerCase() === address.toLowerCase();
          const cached = displayCache.get(m.author.toLowerCase());
          const displayName = cached?.displayName ?? m.displayName;
          const addressPublic = cached !== undefined ? cached.addressPublic : m.addressPublic;

          return (
            <div key={m.id} className={cn("flex gap-2", isMe && "flex-row-reverse")}>
              <div className={cn(
                "max-w-[75%] px-3 py-2 rounded-sm text-sm leading-relaxed",
                isMe
                  ? "bg-primary/20 border border-primary/30 text-foreground"
                  : "bg-secondary/60 border border-border text-foreground",
              )}>
                {/* Always show sender name — even for your own messages on other side */}
                <div className={cn("mb-1", isMe && "text-right")}>
                  <AuthorChip
                    displayName={displayName}
                    author={m.author}
                    addressPublic={addressPublic}
                    isMe={isMe}
                  />
                </div>
                <div>{m.content}</div>
                <div className="text-[10px] text-muted-foreground/60 mt-1 text-right">
                  {timeAgo(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3 flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder={online ? "Send a message…" : "Connecting…"}
          disabled={!online}
          className="flex-1 bg-secondary/40 border-border font-sans"
          maxLength={2000}
        />
        <Button onClick={handleSend} disabled={!online || !text.trim()} size="sm" className="gap-1.5 shrink-0">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────

function PostCard({
  post,
  address,
  myVote: initialMyVote,
  liveComments,
  onVoteDone,
  onAddComment,
}: {
  post: Post;
  address: string;
  myVote: 1 | -1 | null;
  liveComments: Comment[];
  onVoteDone: (postId: number, netScore: number, myVote: 1 | -1 | null) => void;
  onAddComment: (postId: number, content: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [voting, setVoting] = useState(false);
  const myVote = initialMyVote;

  const allComments = React.useMemo(() => {
    const seen = new Set(comments.map((c) => c.id));
    return [...comments, ...liveComments.filter((c) => c.postId === post.id && !seen.has(c.id))]
      .sort((a, b) => a.id - b.id);
  }, [comments, liveComments, post.id]);

  const handleOpen = async () => {
    setOpen((v) => !v);
    if (!open && comments.length === 0) {
      setLoadingComments(true);
      try {
        const res = await fetch(`${BASE}/posts/${post.id}`);
        const data = await res.json() as Post & { comments: Comment[] };
        setComments(data.comments ?? []);
      } catch { /* ignore */ } finally { setLoadingComments(false); }
    }
  };

  const handleVote = async (v: 1 | -1) => {
    if (!address || voting) return;
    setVoting(true);
    try {
      const res = await fetch(`${BASE}/posts/${post.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, vote: v }),
      });
      if (res.ok) {
        const data = await res.json() as { upvotes: number; myVote: 1 | -1 | null };
        onVoteDone(post.id, data.upvotes, data.myVote);
      }
    } catch { /* ignore */ } finally { setVoting(false); }
  };

  const handleComment = () => {
    const t = commentText.trim();
    if (!t) return;
    onAddComment(post.id, t);
    setCommentText("");
  };

  const score = post.upvotes;
  const scoreColor = score > 0 ? "text-primary" : score < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="border border-border rounded-sm bg-secondary/20">
      <div className="flex gap-3 p-4">
        {/* Vote column */}
        <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0 min-w-[28px]">
          <button
            onClick={() => handleVote(1)}
            disabled={!address || voting}
            className={cn(
              "p-0.5 rounded-sm transition-colors",
              myVote === 1
                ? "text-primary"
                : "text-muted-foreground hover:text-primary disabled:opacity-40",
            )}
            title={myVote === 1 ? "Remove upvote" : "Upvote"}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <span className={cn("font-mono text-xs font-bold leading-none", scoreColor)}>
            {score}
          </span>
          <button
            onClick={() => handleVote(-1)}
            disabled={!address || voting}
            className={cn(
              "p-0.5 rounded-sm transition-colors",
              myVote === -1
                ? "text-destructive"
                : "text-muted-foreground hover:text-destructive disabled:opacity-40",
            )}
            title={myVote === -1 ? "Remove downvote" : "Downvote"}
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-foreground text-sm leading-snug mb-1">{post.title}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed line-clamp-3">{post.content}</p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span className="font-mono text-primary/70">{anonName(post.author)}</span>
            <span>{timeAgo(post.createdAt)}</span>
            <button
              onClick={handleOpen}
              className="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
            >
              <MessageSquare className="w-3 h-3" />
              {allComments.length || post.commentCount} comments
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-black/20 px-4 py-3 space-y-3">
          {loadingComments ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading comments…
            </div>
          ) : allComments.length === 0 ? (
            <div className="text-muted-foreground/50 text-xs italic">No comments yet — be first!</div>
          ) : (
            allComments.map((c) => (
              <div key={c.id} className="flex gap-2 text-sm">
                <div className="w-px bg-primary/30 shrink-0 mx-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[10px] text-primary/70 font-bold">{anonName(c.author)}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-foreground/90 leading-relaxed">{c.content}</p>
                </div>
              </div>
            ))
          )}
          <div className="flex gap-2 pt-1">
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleComment()}
              placeholder="Add a comment…"
              className="flex-1 text-sm bg-secondary/40 border-border h-8"
              maxLength={4000}
            />
            <Button onClick={handleComment} disabled={!commentText.trim()} size="sm" className="h-8 px-3 gap-1">
              <Send className="w-3 h-3" /> Post
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New post modal ────────────────────────────────────────────────────────────

function NewPostForm({ onSubmit, onClose }: { onSubmit: (title: string, content: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-border rounded-sm w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg uppercase tracking-tight">New Post</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="bg-secondary/40" maxLength={200} />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          className="w-full min-h-[120px] rounded-sm border border-border bg-secondary/40 text-foreground text-sm p-3 resize-none outline-none focus:border-primary/60 transition-colors"
          maxLength={10000}
        />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { if (title.trim() && content.trim()) onSubmit(title, content); }} disabled={!title.trim() || !content.trim()}>
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "chat" | "forum";

export default function Community() {
  const { activeWallet } = useActiveWallet();
  const address = activeWallet?.address ?? "";

  const [tab, setTab] = useState<Tab>("chat");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [myVotes, setMyVotes] = useState<Map<number, 1 | -1>>(new Map());
  const [liveComments, setLiveComments] = useState<Comment[]>([]);
  const [showNewPost, setShowNewPost] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [displayCache, setDisplayCache] = useState<DisplayCache>(new Map());
  const [myProfile, setMyProfile] = useState<Profile | null>(null);

  // Load own profile on mount
  useEffect(() => {
    if (!address) return;
    fetch(`${BASE}/profile/${address}`)
      .then((r) => (r.ok ? r.json() as Promise<Profile> : null))
      .then((p) => { if (p) setMyProfile(p); })
      .catch(() => {});
  }, [address]);

  const { send, online } = useWs((event) => {
    if (event.type === "history") setChatMessages(event.messages);
    if (event.type === "chat_message") setChatMessages((p) => [...p, event.message].slice(-200));
    if (event.type === "new_comment") setLiveComments((p) => [...p, event.comment].slice(-200));
    if (event.type === "new_post") setPosts((p) => [event.post, ...p]);
    if (event.type === "post_upvoted") {
      setPosts((p) => p.map((post) => post.id === event.postId ? { ...post, upvotes: event.upvotes } : post));
    }
    if (event.type === "profile_updated") {
      setDisplayCache((prev) => {
        const next = new Map(prev);
        next.set(event.address.toLowerCase(), { displayName: event.displayName, addressPublic: event.addressPublic });
        return next;
      });
    }
  });

  // Fetch posts + my votes when forum tab opens
  useEffect(() => {
    if (tab !== "forum" || posts.length > 0) return;
    setLoadingPosts(true);
    const postsReq = fetch(`${BASE}/posts`).then((r) => r.json() as Promise<Post[]>);
    const votesReq = address
      ? fetch(`${BASE}/my-votes?address=${address}`).then((r) => r.ok ? r.json() as Promise<Record<string, number>> : {})
      : Promise.resolve({} as Record<string, number>);
    Promise.all([postsReq, votesReq])
      .then(([loadedPosts, rawVotes]) => {
        setPosts(loadedPosts);
        const vm = new Map<number, 1 | -1>();
        for (const [k, v] of Object.entries(rawVotes)) {
          if (v === 1 || v === -1) vm.set(Number(k), v);
        }
        setMyVotes(vm);
      })
      .catch(() => {})
      .finally(() => setLoadingPosts(false));
  }, [tab, address]);

  const handleVoteDone = (postId: number, netScore: number, userVote: 1 | -1 | null) => {
    setPosts((p) => p.map((post) => post.id === postId ? { ...post, upvotes: netScore } : post));
    setMyVotes((prev) => {
      const next = new Map(prev);
      if (userVote === null) next.delete(postId);
      else next.set(postId, userVote);
      return next;
    });
  };

  const handleSendChat = (content: string) => {
    if (!address) return;
    send({ type: "chat", author: address, content });
  };

  const handleAddComment = (postId: number, content: string) => {
    if (!address) return;
    send({ type: "comment", author: address, postId, content });
  };

  const handleNewPost = async (title: string, content: string) => {
    if (!address) return;
    setShowNewPost(false);
    try {
      await fetch(`${BASE}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: address, title, content }),
      });
    } catch { /* ignore */ }
  };

  const handleProfileSaved = (profile: Profile) => {
    setMyProfile(profile);
    setShowProfile(false);
    if (address) {
      setDisplayCache((prev) => {
        const next = new Map(prev);
        next.set(address.toLowerCase(), {
          displayName: profile.nickname ?? anonName(address),
          addressPublic: profile.addressPublic,
        });
        return next;
      });
    }
  };

  const myDisplayName = (() => {
    const cached = displayCache.get(address.toLowerCase());
    if (cached) return cached.displayName;
    return myProfile?.nickname ?? (address ? anonName(address) : null);
  })();

  return (
    <Shell requireWallet={false}>
      {showNewPost && <NewPostForm onSubmit={handleNewPost} onClose={() => setShowNewPost(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight text-foreground uppercase">Forge Community</h1>
            <p className="text-sm text-muted-foreground">Live chat · discussion · mining talk · sign in with your EMBR wallet</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-sm border",
            online ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-muted-foreground border-border bg-secondary/30",
          )}>
            <div className={cn("w-1.5 h-1.5 rounded-full", online ? "bg-green-400 animate-pulse" : "bg-muted-foreground")} />
            {online ? "Live" : "Connecting…"}
          </div>

          {address && (
            <div className="relative">
              <button
                onClick={() => setShowProfile((v) => !v)}
                className={cn(
                  "flex items-center gap-2 text-xs font-bold border rounded-sm px-2.5 py-1.5 transition-all",
                  showProfile
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-border/80 bg-secondary/30",
                )}
              >
                {myProfile && !myProfile.addressPublic && <EyeOff className="w-3 h-3 shrink-0" />}
                <span className="font-mono">{myDisplayName}</span>
                <Settings className="w-3 h-3 shrink-0" />
              </button>
              {showProfile && (
                <ProfilePanel address={address} onClose={() => setShowProfile(false)} onSaved={handleProfileSaved} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([["chat", "Live Chat", Hash], ["forum", "Forum", FileText]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-bold uppercase tracking-wide border-b-2 transition-all",
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {tab === "chat" && (
          <Card className="border-border bg-card overflow-hidden flex flex-col" style={{ height: "62vh" }}>
            <div className="bg-secondary/40 border-b border-border px-4 py-2 flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
              <Hash className="w-3.5 h-3.5 text-primary" /> general
              <span className="ml-auto flex items-center gap-1">
                <Users className="w-3 h-3" /> {chatMessages.length > 0 ? `${chatMessages.length} messages` : "Say hello!"}
              </span>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {!address ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                  <MessageSquare className="w-12 h-12 text-muted-foreground/30" />
                  <p className="text-muted-foreground font-bold uppercase text-sm">Wallet required to chat</p>
                  <p className="text-muted-foreground text-sm">Connect your EMBR wallet to join the conversation.</p>
                </div>
              ) : (
                <LiveChat address={address} messages={chatMessages} displayCache={displayCache} onSend={handleSendChat} online={online} />
              )}
            </div>
          </Card>
        )}

        {tab === "forum" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                {posts.length} post{posts.length !== 1 ? "s" : ""}
              </p>
              {address && (
                <Button onClick={() => setShowNewPost(true)} size="sm" className="gap-2">
                  <Plus className="w-4 h-4" /> New Post
                </Button>
              )}
            </div>

            {loadingPosts ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading posts…
              </div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/30" />
                <p className="text-muted-foreground font-bold uppercase">No posts yet</p>
                {address && (
                  <Button onClick={() => setShowNewPost(true)} size="sm" variant="outline" className="gap-2">
                    <Plus className="w-4 h-4" /> Start the conversation
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    address={address}
                    myVote={myVotes.get(post.id) ?? null}
                    liveComments={liveComments}
                    onVoteDone={handleVoteDone}
                    onAddComment={handleAddComment}
                  />
                ))}
              </div>
            )}

            {!address && (
              <div className="flex items-center gap-3 p-3 rounded-sm border border-border bg-secondary/20 text-sm text-muted-foreground">
                <MessageSquare className="w-4 h-4 shrink-0" />
                Connect your EMBR wallet to post, comment, and vote.
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
