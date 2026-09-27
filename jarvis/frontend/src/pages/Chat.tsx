import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUp, Loader2, Mic, MessageSquarePlus, Paperclip, Pin, Square, Trash2, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { ApprovalCard } from "../components/Approvals";
import { Markdown } from "../components/Markdown";
import { Orb } from "../components/Orb";
import { Badge, Button, Empty, Spinner } from "../components/ui";
import { del, get, post, upload } from "../lib/api";
import { CHANNEL, ago, time } from "../lib/format";
import { useRealtime } from "../lib/realtime";
import type { Approval, Conversation, Message } from "../lib/types";

interface MessagesResponse {
  conversation: Conversation;
  messages: Message[];
  running: { task_id: string; status: string }[];
}

function ConversationList({ activeId }: { activeId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["conversations"], queryFn: () => get<{ conversations: Conversation[] }>("/api/conversations") });
  const create = useMutation({
    mutationFn: () => post<Conversation>("/api/conversations", { title: "" }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/chat/${c.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/conversations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate("/chat");
    },
  });
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">Разговоры</p>
        <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="size-3.5" />} onClick={() => create.mutate()}>
          Новый
        </Button>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {(data?.conversations ?? []).map((c) => (
          <li key={c.id} className="group relative">
            <button
              onClick={() => navigate(`/chat/${c.id}`)}
              className={clsx(
                "w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                c.id === activeId ? "bg-accent-soft" : "hover:bg-hover",
              )}
            >
              <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                {c.is_primary && <Pin className="size-3 shrink-0 text-accent" />}
                <span className="truncate">{c.is_primary ? "JARVIS · основной" : c.title || "Без названия"}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-faint">
                {ago(c.updated_at)} · {c.messages ?? 0} сообщ.
              </p>
            </button>
            {!c.is_primary && (
              <button
                onClick={() => confirm("Удалить разговор?") && remove.mutate(c.id)}
                className="absolute top-2 right-2 hidden rounded p-1 text-faint hover:bg-hover hover:text-danger group-hover:block"
                aria-label="Удалить"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  if (m.role === "notice")
    return (
      <div className="flex justify-center">
        <p className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-muted">{m.content}</p>
      </div>
    );
  const mine = m.role === "user";
  return (
    <div className={clsx("flex gap-3", mine && "justify-end")}>
      {!mine && <div className="mt-1 shrink-0"><Orb state="idle" size={26} /></div>}
      <div className={clsx("min-w-0", mine ? "max-w-[85%] sm:max-w-[70%]" : "max-w-full flex-1 sm:max-w-[85%]")}>
        <div
          className={clsx(
            "text-[14.5px] leading-relaxed [overflow-wrap:anywhere]",
            mine ? "rounded-2xl rounded-br-md bg-elevated px-4 py-2.5 whitespace-pre-wrap" : "pt-0.5",
          )}
        >
          {mine ? m.content : <Markdown text={m.content} />}
        </div>
        {m.attachments?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.attachments.map((a) => (
              <Badge key={a.path} tone="muted"><Paperclip className="size-3" /> {a.name ?? a.path.split("/").pop()}</Badge>
            ))}
          </div>
        )}
        <div className={clsx("mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint", mine && "justify-end")}>
          {m.channel !== "web" && <Badge tone="violet">{CHANNEL[m.channel] ?? m.channel}</Badge>}
          {m.tool_trace?.map((t, i) => (
            <span key={i} className={clsx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]", t.ok ? "border-line text-muted" : "border-danger/30 text-danger")}>
              <Wrench className="size-2.5" />{t.name}
            </span>
          ))}
          <time>{time(m.created_at)}</time>
        </div>
      </div>
    </div>
  );
}

function LiveTurn({ taskId, taskStatus, onStop }: { taskId: string; taskStatus: string; onStop: () => void }) {
  const stream = useRealtime((s) => s.streams[taskId]);
  const live = useRealtime((s) => s.status[taskId]);
  const status = taskStatus === "waiting_approval" && (!live || live.state !== "tool")
    ? { state: "waiting_approval", label: "Жду вашего подтверждения", at: 0 }
    : live ?? (taskStatus === "queued" ? { state: "thinking", label: "В очереди…", at: 0 } : undefined);
  return (
    <div className="flex gap-3">
      <div className="mt-1 shrink-0">
        <Orb state={status?.state === "tool" ? "tool" : status?.state === "waiting_approval" ? "waiting" : "thinking"} size={26} />
      </div>
      <div className="min-w-0 flex-1 sm:max-w-[85%]">
        {stream?.text ? (
          <div className="streaming-caret text-[14.5px] leading-relaxed">
            <Markdown text={stream.text} />
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          {status?.state === "waiting_approval" ? null : <Loader2 className="size-3 animate-spin text-accent" />}
          <span className="animate-pulse-soft">{status?.label ?? "Думаю…"}</span>
          <button onClick={onStop} className="ml-1 inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-danger/40 hover:text-danger">
            <Square className="size-2.5" /> Стоп
          </button>
        </div>
      </div>
    </div>
  );
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

export function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<{ path: string; name: string; mime: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [showList, setShowList] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const clearStream = useRealtime((s) => s.clearStream);

  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => get<{ conversations: Conversation[] }>("/api/conversations") });
  useEffect(() => {
    if (!conversationId && convs.data) {
      const primary = convs.data.conversations.find((c) => c.is_primary);
      if (primary) navigate(`/chat/${primary.id}`, { replace: true });
    }
  }, [conversationId, convs.data, navigate]);

  const msgs = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => get<MessagesResponse>(`/api/conversations/${conversationId}/messages?limit=100`),
    enabled: !!conversationId,
  });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => get<{ approvals: Approval[] }>("/api/approvals") });
  const running = msgs.data?.running ?? [];
  const runningIds = useMemo(() => new Set(running.map((r) => r.task_id)), [running]);
  const localApprovals = (approvals.data?.approvals ?? []).filter((a) => runningIds.has(a.task_id));

  useEffect(() => {
    // streams for turns that finished are no longer needed once the persisted message arrived
    const done = (msgs.data?.messages ?? []).map((m) => m.task_id).filter(Boolean) as string[];
    done.forEach((id) => !runningIds.has(id) && clearStream(id));
  }, [msgs.data, runningIds, clearStream]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs.data?.messages.length, running.length]);

  const liveText = useRealtime((s) => running.map((r) => s.streams[r.task_id]?.text?.length ?? 0).join(","));
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [liveText]);

  const send = useMutation({
    mutationFn: () => post<{ task_id: string }>("/api/chat", { text, conversation_id: conversationId, attachments }),
    onSuccess: () => {
      setText("");
      setAttachments([]);
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
  });
  const cancel = useMutation({ mutationFn: (taskId: string) => post(`/api/tasks/${taskId}/cancel`) });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const r = await upload(f);
        setAttachments((a) => [...a, { path: r.path, name: r.name, mime: r.mime }]);
      }
    } finally {
      setUploading(false);
    }
  };

  const dictate = () => {
    const Ctor = ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
      .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition);
    if (!Ctor) {
      navigate("/voice");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => setText((t) => `${t}${t ? " " : ""}${e.results[0][0].transcript}`);
    rec.onend = () => setDictating(false);
    setDictating(true);
    rec.start();
  };

  const canSend = (text.trim() || attachments.length) && !send.isPending;
  const messages = msgs.data?.messages ?? [];

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface md:block">
        <ConversationList activeId={conversationId} />
      </aside>
      {showList && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setShowList(false)}>
          <aside className="h-full w-72 bg-surface" onClick={(e) => e.stopPropagation()}>
            <ConversationList activeId={conversationId} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 md:hidden">
          <Button size="sm" variant="ghost" onClick={() => setShowList(true)}>Разговоры</Button>
          <p className="truncate text-sm font-medium">{msgs.data?.conversation.is_primary ? "JARVIS" : msgs.data?.conversation.title}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
            {msgs.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
            {!msgs.isLoading && !messages.length && !running.length && (
              <Empty icon={<Orb state="idle" size={56} />} title="Чем займёмся?">
                Спросите что угодно, поручите задачу или скажите «запомни…». Этот разговор общий для Web, Telegram, WhatsApp и голоса.
              </Empty>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
            {running.map((r) => (
              <LiveTurn key={r.task_id} taskId={r.task_id} taskStatus={r.status} onStop={() => cancel.mutate(r.task_id)} />
            ))}
            {localApprovals.map((a) => (
              <ApprovalCard key={a.id} approval={a} compact />
            ))}
            <div ref={bottom} />
          </div>
        </div>
        <div className="border-t border-line bg-bg px-4 pt-3 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span key={a.path} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-muted">
                    <Paperclip className="size-3" /> {a.name}
                    <button onClick={() => setAttachments((x) => x.filter((y) => y.path !== a.path))} aria-label="Убрать"><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canSend) send.mutate();
              }}
              className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/10"
            >
              <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-text" title="Прикрепить файл">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                <input type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
              </label>
              <textarea
                ref={textarea}
                rows={1}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (canSend) send.mutate();
                  }
                }}
                placeholder="Напишите JARVIS…"
                title="Enter — отправить, Shift+Enter — новая строка"
                className="max-h-56 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] outline-none placeholder:text-faint"
              />
              <button type="button" onClick={dictate} className={clsx("flex size-9 shrink-0 items-center justify-center rounded-lg", dictating ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-text")} title="Диктовка">
                <Mic className={clsx("size-4", dictating && "animate-pulse-soft")} />
              </button>
              <Button type="submit" variant="primary" size="icon" className="size-9 rounded-lg" disabled={!canSend} loading={send.isPending} aria-label="Отправить">
                {!send.isPending && <ArrowUp className="size-4" />}
              </Button>
            </form>
            {send.error && <p className="mt-2 text-xs text-danger">{(send.error as Error).message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
