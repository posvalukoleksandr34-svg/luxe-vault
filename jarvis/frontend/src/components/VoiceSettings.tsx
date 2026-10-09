import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { get, put } from "../lib/api";
import type { VoiceProfile } from "../voice/client";
import { Badge, Button, ErrorNote, Field, Input, Select, Spinner, Switch, Textarea } from "./ui";

interface VoiceConfig {
  stt: string;
  tts: string;
  profile: VoiceProfile;
  providers: { tts: string[]; stt: string[] };
}
interface VoiceItem {
  id: string;
  name: string;
  gender?: string | null;
  accent?: string | null;
  category?: string | null;
  provider: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  auto: "Автоматически", elevenlabs: "ElevenLabs", openai: "OpenAI", browser: "Браузер (бесплатно)", deepgram: "Deepgram",
};

function browserVoices(): VoiceItem[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices()
    .filter((v) => /^(ru|en)/i.test(v.lang))
    .map((v) => ({ id: v.name, name: `${v.name} (${v.lang})`, provider: "browser", category: v.localService ? "local" : "online" }));
}

/** Voice persona: provider, voice (incl. custom ElevenLabs voices), speed, pitch, style, hands-free listening. */
export function VoiceSettings({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["voice-config"], queryFn: () => get<VoiceConfig>("/api/voice/config") });
  const [p, setP] = useState<VoiceProfile | null>(null);
  const [wake, setWake] = useState("");
  const [bVoices, setBVoices] = useState<VoiceItem[]>(browserVoices());
  useEffect(() => {
    if (cfg.data && !p) {
      setP(cfg.data.profile);
      setWake(cfg.data.profile.wake_words.join(", "));
    }
  }, [cfg.data, p]);
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const upd = () => setBVoices(browserVoices());
    speechSynthesis.addEventListener("voiceschanged", upd);
    return () => speechSynthesis.removeEventListener("voiceschanged", upd);
  }, []);

  const effective = p?.tts_provider === "auto" ? cfg.data?.tts ?? "browser" : p?.tts_provider ?? "browser";
  const serverVoices = useQuery({
    queryKey: ["voices", effective],
    queryFn: () => get<{ voices: VoiceItem[] }>(`/api/voice/voices?provider=${effective}`),
    enabled: effective === "openai" || effective === "elevenlabs",
  });
  const voices = useMemo(() => (effective === "browser" ? bVoices : serverVoices.data?.voices ?? []), [effective, bVoices, serverVoices.data]);
  const knownVoice = voices.some((v) => v.id === p?.voice_id);

  const save = useMutation({
    mutationFn: () => put("/api/voice/profile", { ...p, wake_words: wake.split(",").map((w) => w.trim()).filter(Boolean) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["voice-config"] }); onSaved?.(); },
  });
  const [previewErr, setPreviewErr] = useState<unknown>(null);
  const [previewing, setPreviewing] = useState(false);
  const preview = async () => {
    if (!p) return;
    setPreviewErr(null);
    const text = "Добрый вечер. Я JARVIS — чем могу помочь?";
    if (effective === "browser") {
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find((x) => x.name === p.voice_id);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "ru-RU";
      u.rate = p.speed;
      u.pitch = p.pitch;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch("/api/voice/preview", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Jarvis-Request": "1" },
        body: JSON.stringify({ ...p, tts_provider: effective, text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      await audio.play();
    } catch (e) {
      setPreviewErr(e);
    } finally {
      setPreviewing(false);
    }
  };

  if (!p || !cfg.data) return <div className="flex justify-center p-6"><Spinner /></div>;
  const set = (patch: Partial<VoiceProfile>) => setP({ ...p, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Синтез речи (голос)" hint={`Сейчас: ${PROVIDER_LABEL[cfg.data.tts] ?? cfg.data.tts}`}>
          <Select value={p.tts_provider} onChange={(e) => set({ tts_provider: e.target.value as VoiceProfile["tts_provider"], voice_id: null, voice_name: null })} className="w-full">
            <option value="auto">Автоматически</option>
            {cfg.data.providers.tts.map((x) => <option key={x} value={x}>{PROVIDER_LABEL[x] ?? x}</option>)}
          </Select>
        </Field>
        <Field label="Распознавание речи" hint={`Сейчас: ${PROVIDER_LABEL[cfg.data.stt] ?? cfg.data.stt}`}>
          <Select value={p.stt_provider} onChange={(e) => set({ stt_provider: e.target.value as VoiceProfile["stt_provider"] })} className="w-full">
            <option value="auto">Автоматически</option>
            {cfg.data.providers.stt.map((x) => <option key={x} value={x}>{PROVIDER_LABEL[x] ?? x}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Голос" hint={effective === "elevenlabs" ? "Включая ваши собственные (клонированные) голоса из аккаунта ElevenLabs" : undefined}>
        {serverVoices.isLoading ? <Spinner /> : (
          <Select value={knownVoice ? p.voice_id ?? "" : p.voice_id ? "__custom" : ""} className="w-full"
            onChange={(e) => {
              const v = voices.find((x) => x.id === e.target.value);
              set(e.target.value === "__custom" ? { voice_id: p.voice_id ?? "" } : { voice_id: v?.id ?? null, voice_name: v?.name ?? null });
            }}>
            <option value="">По умолчанию</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{v.gender ? ` · ${v.gender === "male" ? "мужской" : v.gender === "female" ? "женский" : v.gender}` : ""}{v.category === "cloned" || v.category === "professional" ? " · свой" : ""}
              </option>
            ))}
            {effective === "elevenlabs" && <option value="__custom">Свой voice ID…</option>}
          </Select>
        )}
      </Field>
      {effective === "elevenlabs" && !knownVoice && p.voice_id !== null && (
        <Field label="ElevenLabs voice ID" hint="Голос из вашего аккаунта ElevenLabs (Voice Lab → ID). Используйте только голоса, на которые у вас есть права.">
          <Input value={p.voice_id ?? ""} onChange={(e) => set({ voice_id: e.target.value, voice_name: "Custom" })} placeholder="21m00Tcm4TlvDq8ikWAM" />
        </Field>
      )}
      <ErrorNote error={serverVoices.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Скорость: ${p.speed.toFixed(2)}×`} hint={effective === "elevenlabs" ? "ElevenLabs: 0.7–1.2" : effective === "openai" ? "OpenAI: передаётся как указание стиля" : undefined}>
          <input type="range" min={0.5} max={2} step={0.05} value={p.speed} onChange={(e) => set({ speed: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
        </Field>
        {effective === "browser" && (
          <Field label={`Высота: ${p.pitch.toFixed(2)}`} hint="Только для голосов браузера">
            <input type="range" min={0.5} max={2} step={0.05} value={p.pitch} onChange={(e) => set({ pitch: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
          </Field>
        )}
      </div>
      {effective === "openai" && (
        <Field label="Стиль речи" hint="Например: «спокойно, с лёгкой британской иронией»">
          <Textarea rows={2} value={p.style} onChange={(e) => set({ style: e.target.value })} />
        </Field>
      )}

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-xs text-muted">
            <p className="text-sm text-text">Режим без рук (wake word)</p>
            Микрофон слушает постоянно, но JARVIS реагирует только на фразы, которые начинаются со слова-активатора
            («Джарвис, открой Chrome»). После ответа {p.follow_up_s} с можно продолжать без него.
          </div>
          <Switch checked={p.hands_free} onChange={(v) => set({ hands_free: v })} label="Режим без рук" />
        </div>
        {p.hands_free && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Слова-активаторы" hint="Через запятую"><Input value={wake} onChange={(e) => setWake(e.target.value)} /></Field>
            <Field label="Окно продолжения, с"><Input type="number" min={0} max={60} value={p.follow_up_s} onChange={(e) => set({ follow_up_s: Number(e.target.value) })} /></Field>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={<Play className="size-4" />} loading={previewing} onClick={preview}>Прослушать</Button>
        <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
        {save.isSuccess && <Badge tone="ok">Сохранено</Badge>}
      </div>
      <ErrorNote error={previewErr ?? save.error} />
    </div>
  );
}

