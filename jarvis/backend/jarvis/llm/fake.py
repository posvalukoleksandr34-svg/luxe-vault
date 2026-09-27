"""Deterministic model stand-ins.

- `ScriptedProvider` — tests supply exact responses (or a function of the request).
- `DemoBrain` — a small rule-based "brain" for offline demos (JARVIS_FAKE_LLM=true) and
  end-to-end tests of the whole pipeline (tools, permissions, memory, scheduler) without
  an API key. It is NOT intelligence: it recognises a handful of Russian/English
  phrasings (remember / recall / remind / schedule meeting / calendar / e-mail draft /
  weekly automation) and otherwise explains that a real model key is needed.
"""

from __future__ import annotations

import copy
import json
import re
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from jarvis.llm.types import LLMProvider, LLMRequest, LLMResponse, RouteConfig, TextCallback, Usage


def _tid() -> str:
    return f"toolu_demo_{uuid.uuid4().hex[:16]}"


def text_response(text: str) -> LLMResponse:
    return LLMResponse(content=[{"type": "text", "text": text}], stop_reason="end_turn",
                       usage=Usage(input_tokens=10, output_tokens=max(1, len(text) // 4)), model="scripted")


def tool_response(name: str, args: dict[str, Any], text: str = "", tool_id: str | None = None) -> LLMResponse:
    content: list[dict[str, Any]] = [{"type": "text", "text": text}] if text else []
    content.append({"type": "tool_use", "id": tool_id or _tid(), "name": name, "input": args})
    return LLMResponse(content=content, stop_reason="tool_use", usage=Usage(input_tokens=10, output_tokens=20),
                       model="scripted")


async def _stream(text: str, on_text: TextCallback | None) -> None:
    if on_text is None or not text:
        return
    for i in range(0, len(text), 24):
        await on_text(text[i : i + 24])


class ScriptedProvider(LLMProvider):
    name = "scripted"

    def __init__(self, script: list[LLMResponse] | Callable[[LLMRequest, RouteConfig], LLMResponse]):
        self.script = script
        self.requests: list[LLMRequest] = []

    async def generate(self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None) -> LLMResponse:
        self.requests.append(copy.deepcopy(req))  # snapshot: the harness keeps appending to its lists
        if callable(self.script):
            resp = self.script(req, route)
        else:
            if not self.script:
                raise AssertionError("ScriptedProvider ran out of responses")
            resp = self.script.pop(0)
        await _stream(resp.text, on_text)
        return resp


# ------------------------------------------------------------------------------------------ demo brain

_WEEKDAYS = {
    "понедельник": 1, "вторник": 2, "сред": 3, "четверг": 4, "пятниц": 5, "суббот": 6, "воскресен": 0,
    "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "sunday": 0,
}


def _context_now(req: LLMRequest) -> datetime:
    for m in req.messages:
        content = m.get("content")
        blocks = content if isinstance(content, list) else [{"type": "text", "text": content}]
        for b in blocks:
            if b.get("type") == "text":
                mt = re.search(r"now: (\d{4}-\d{2}-\d{2} \d{2}:\d{2})", b.get("text") or "")
                if mt:
                    return datetime.strptime(mt.group(1), "%Y-%m-%d %H:%M")
    return datetime.now()


def _user_text(msg: dict[str, Any]) -> str:
    content = msg.get("content")
    if isinstance(content, str):
        return content
    texts = [b.get("text", "") for b in content if b.get("type") == "text" and not b.get("text", "").startswith("<context")]
    return (texts[-1] if texts else "").strip()


def parse_when(text: str, now: datetime) -> tuple[datetime | None, str]:
    """Very small RU/EN time parser. Returns (local datetime, text with the time phrase removed)."""
    t = text
    day = now.date()
    if re.search(r"\b(послезавтра|day after tomorrow)\b", t, re.I):
        day = day + timedelta(days=2)
        t = re.sub(r"\b(послезавтра|day after tomorrow)\b", "", t, flags=re.I)
    elif re.search(r"\b(завтра|tomorrow)\b", t, re.I):
        day = day + timedelta(days=1)
        t = re.sub(r"\b(завтра|tomorrow)\b", "", t, flags=re.I)
    elif re.search(r"\b(сегодня|today)\b", t, re.I):
        t = re.sub(r"\b(сегодня|today)\b", "", t, flags=re.I)
    m = re.search(r"\bчерез\s+(\d+)\s*(мин|час)|\bin\s+(\d+)\s*(min|hour)", t, re.I)
    if m:
        n = int(m.group(1) or m.group(3))
        unit = (m.group(2) or m.group(4)).lower()
        delta = timedelta(hours=n) if unit.startswith(("час", "hour")) else timedelta(minutes=n)
        return now + delta, (t[: m.start()] + t[m.end():])
    m = re.search(r"\b(?:в|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|утра|вечера|дня)?", t, re.I)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2) or 0)
        suffix = (m.group(3) or "").lower()
        if suffix in ("pm", "вечера", "дня") and hour < 12:
            hour += 12
        when = datetime.combine(day, datetime.min.time()).replace(hour=hour % 24, minute=minute)
        if when <= now and day == now.date():
            when += timedelta(days=1)
        return when, (t[: m.start()] + t[m.end():])
    if day != now.date():
        return datetime.combine(day, datetime.min.time()).replace(hour=9), t
    return None, t


def _clean(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip(" ,.!?:;—-")
    return s[:1].upper() + s[1:] if s else s


class DemoBrain(LLMProvider):
    name = "demo"

    async def generate(self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None) -> LLMResponse:
        if req.output_schema is not None:
            props = req.output_schema.get("properties", {})
            key = "memories" if "memories" in props else "decisions"
            return text_response(json.dumps({key: []}))
        resp = self._decide(req)
        await _stream(resp.text, on_text)
        return resp

    # -- helpers
    @staticmethod
    def _tool_names(req: LLMRequest) -> set[str]:
        return {t.get("name") for t in req.tools}

    def _decide(self, req: LLMRequest) -> LLMResponse:
        last = req.messages[-1]
        results = [b for b in last["content"] if isinstance(last.get("content"), list) and b.get("type") == "tool_result"] \
            if isinstance(last.get("content"), list) else []
        if results:
            return self._after_tools(req, results)
        return self._first_step(req, _user_text(last))

    def _first_step(self, req: LLMRequest, text: str) -> LLMResponse:
        low = text.lower()
        now = _context_now(req)
        tools = self._tool_names(req)

        m = re.match(r"^(?:jarvis[,!]?\s*)?(?:запомни|remember)[,:]?\s*(?:что|that)?\s*(.+)$", text, re.I | re.S)
        if m and "memory_remember" in tools:
            fact = _clean(m.group(1))
            fact = re.sub(r"^Мне нравится", "Пользователю нравится", fact)
            fact = re.sub(r"^Я люблю", "Пользователь любит", fact)
            fact = re.sub(r"^I like", "The user likes", fact)
            return tool_response("memory_remember", {"content": fact, "kind": "profile", "subject": "user",
                                                     "importance": 0.7})

        if re.search(r"что мне нравится|что я люблю|что ты (обо мне )?(знаешь|помнишь)|what do i like|"
                     r"what do you (know|remember)", low) and "memory_search" in tools:
            query = "нравится любит" if re.search(r"нравится|люблю|like", low) else text
            return tool_response("memory_search", {"query": query, "limit": 8})

        if re.search(r"\b(напомни|remind me)", low) and "reminder_create" in tools:
            when, rest = parse_when(text, now)
            what = re.sub(r"^(?:jarvis[,!]?\s*)?(напомни(те)?\s*(мне)?|remind me( to)?)", "", rest.strip(), flags=re.I)
            what = _clean(what) or "Напоминание"
            if when is None:
                return text_response("Когда напомнить? Скажите, например: «завтра в 10».")
            return tool_response("reminder_create", {"text": what, "when": when.strftime("%Y-%m-%dT%H:%M")})

        wd = next((v for k, v in _WEEKDAYS.items() if re.search(rf"(кажд\w+|every)\s+{k}", low)), None)
        if wd is not None and "automation_create" in tools:
            hm = re.search(r"\b(?:в|at)\s+(\d{1,2})(?::(\d{2}))?", text)
            hour, minute = (int(hm.group(1)), int(hm.group(2) or 0)) if hm else (9, 0)
            body = re.sub(r"^.*?(кажд\w+|every)\s+\w+[,]?\s*", "", text, flags=re.I)
            body = re.sub(r"\b(?:в|at)\s+\d{1,2}(?::\d{2})?", "", body)
            prompt = _clean(body) or "Сделай еженедельный обзор"
            return tool_response("automation_create", {"name": prompt[:60], "prompt": prompt,
                                                       "cron": f"{minute} {hour} * * {wd}"})

        if re.search(r"(назначь|запланируй|создай|поставь)\s+(встречу|созвон|событие)|schedule (a )?(meeting|call)", low) \
                and "calendar_create_event" in tools:
            when, rest = parse_when(text, now)
            if when is None:
                return text_response("На какое время назначить встречу?")
            day_start = when.replace(hour=0, minute=0)
            return tool_response("calendar_list_events", {
                "start": day_start.strftime("%Y-%m-%dT%H:%M"),
                "end": (day_start + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")},
                text="Проверяю календарь.")

        if re.search(r"(что у меня|покажи|what'?s on).*(календар|calendar|план|schedule)", low) \
                and "calendar_list_events" in tools:
            when, _ = parse_when(text, now)
            base = (when or now).replace(hour=0, minute=0)
            return tool_response("calendar_list_events", {"start": base.strftime("%Y-%m-%dT%H:%M"),
                                                          "end": (base + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")})

        m = re.search(r"(?:напиши|составь)\s+письмо\s+(.+)|write an email to\s+(.+)", text, re.I)
        if m and "email_create_draft" in tools:
            rest = (m.group(1) or m.group(2)).strip()
            email = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", rest)
            to = email.group(0) if email else _clean(rest.split(" о ")[0].split(" про ")[0])
            topic = rest.split(" о ", 1)[1] if " о " in rest else rest.split(" про ", 1)[1] if " про " in rest else "встреча"
            body = (f"Здравствуйте!\n\nПишу по поводу: {topic.strip()}.\n\nС уважением,\n"
                    "{name}").replace("{name}", "")
            return tool_response("email_create_draft", {"to": [to], "subject": _clean(topic)[:120], "body": body.strip()})

        if re.search(r"найди|исследуй|research|find information", low):
            return text_response("В демо-режиме я не умею искать в интернете. Подключите ключ ANTHROPIC_API_KEY "
                                 "(Settings → Models), и я проведу исследование и соберу отчёт.")

        return text_response(
            "Я работаю в демо-режиме без языковой модели и понимаю только простые команды: «запомни …», "
            "«что мне нравится?», «напомни завтра в 10 …», «назначь встречу с … завтра в 15:00», "
            "«что у меня завтра в календаре?», «напиши письмо … о …», «каждую пятницу …». "
            "Добавьте ANTHROPIC_API_KEY, чтобы включить полноценный интеллект.")

    def _after_tools(self, req: LLMRequest, results: list[dict[str, Any]]) -> LLMResponse:
        # find the tool_use blocks of the previous assistant message
        prev = req.messages[-2] if len(req.messages) >= 2 else {"content": []}
        uses = {b["id"]: b for b in prev.get("content", []) if isinstance(prev.get("content"), list)
                and b.get("type") == "tool_use"}
        r = results[0]
        use = uses.get(r["tool_use_id"], {"name": "?", "input": {}})
        raw = r.get("content")
        content = raw if isinstance(raw, str) else json.dumps(raw)
        if r.get("is_error"):
            return text_response(f"Не получилось: {content.removeprefix('Error: ')}")
        try:
            data = json.loads(content)
        except (ValueError, TypeError):
            data = {"text": content}
        name = use["name"]
        if "declined" in content or "не одобр" in content:
            return text_response("Хорошо, не выполняю это действие.")
        if name == "memory_remember":
            return text_response(f"Запомнил: {data.get('content', '')}")
        if name == "memory_search":
            items = data.get("results", [])
            if not items:
                return text_response("Пока ничего не помню об этом.")
            return text_response("Вот что я помню:\n" + "\n".join(f"- {i['content']}" for i in items[:6]))
        if name == "reminder_create":
            return text_response(f"Готово — напомню {data.get('fires_at')}: «{data.get('text')}».")
        if name == "automation_create":
            return text_response(f"Настроил автоматизацию «{data.get('name')}». Следующий запуск: {data.get('next_run')}.")
        if name == "calendar_list_events":
            user_text = next((_user_text(m) for m in reversed(req.messages) if m["role"] == "user"
                              and not (isinstance(m.get("content"), list) and any(
                                  b.get("type") == "tool_result" for b in m["content"]))), "")
            if re.search(r"назначь|запланируй|создай|поставь|schedule", user_text.lower()):
                when, rest = parse_when(user_text, _context_now(req))
                who = re.search(r"\bс\s+([A-ZА-ЯЁ][\w-]+(?:\s+[A-ZА-ЯЁ][\w-]+)?)|with\s+([A-Z][\w-]+)", user_text)
                title = f"Встреча с {who.group(1) or who.group(2)}" if who else "Встреча"
                busy = [e for e in data.get("events", []) if e["start"][11:16] <= when.strftime("%H:%M") < e["end"][11:16]]
                if busy:
                    return text_response(f"В это время уже есть «{busy[0]['title']}». Выбрать другое время?")
                return tool_response("calendar_create_event", {
                    "title": title, "start": when.strftime("%Y-%m-%dT%H:%M"),
                    "end": (when + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")},
                    text="Время свободно — создаю событие.")
            events = data.get("events", [])
            if not events:
                return text_response("В календаре на этот день ничего нет.")
            return text_response("В календаре:\n" + "\n".join(f"- {e['start'][11:16]}–{e['end'][11:16]} {e['title']}"
                                                              for e in events))
        if name == "calendar_create_event":
            ev = data.get("event", data)
            return text_response(f"Встреча «{ev.get('title')}» создана: {str(ev.get('start', ''))[:16].replace('T', ' ')}.")
        if name == "email_create_draft":
            d = data.get("draft", data)
            return text_response(f"Черновик готов:\nКому: {', '.join(d.get('to', []))}\nТема: {d.get('subject')}\n\n"
                                 f"{d.get('body')}\n\nОтправить?")
        return text_response("Готово.")
