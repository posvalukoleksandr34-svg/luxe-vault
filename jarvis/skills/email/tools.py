"""E-mail tools (Gmail REST when connected, local drafts otherwise)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from jarvis.integrations.mail import Gmail, LocalDrafts, validate_addresses
from jarvis.tools.base import Risk, ToolContext, ToolError, tool


async def _gmail(ctx: ToolContext) -> Gmail | None:
    return Gmail(ctx.app, ctx.user_id) if (await ctx.app.availability(ctx.user_id)).get("google") else None


class SearchArgs(BaseModel):
    query: str = Field(description="Gmail search syntax, e.g. 'is:unread newer_than:2d' or 'from:anna@x.com'")
    limit: int = Field(10, ge=1, le=30)


@tool(name="email_search", description="Search the mailbox and return senders, subjects and snippets.",
      activity="Проверяю почту", untrusted_output=True, timeout_s=45, retries=1)
async def email_search(ctx: ToolContext, args: SearchArgs) -> dict:
    gmail = await _gmail(ctx)
    if gmail is None:
        raise ToolError("no mailbox connected", hint="connect Google in Integrations to read mail")
    return {"messages": await gmail.search(args.query, args.limit)}


class ReadArgs(BaseModel):
    message_id: str


@tool(name="email_read", description="Read the full text of one e-mail.", activity="Читаю письмо",
      untrusted_output=True, timeout_s=30, retries=1)
async def email_read(ctx: ToolContext, args: ReadArgs) -> dict:
    gmail = await _gmail(ctx)
    if gmail is None:
        raise ToolError("no mailbox connected", hint="connect Google in Integrations")
    return await gmail.read(args.message_id)


class DraftArgs(BaseModel):
    to: list[str] = Field(min_length=1, description="Recipient e-mail addresses (or names for a local draft)")
    subject: str = Field(max_length=300)
    body: str = Field(max_length=20000)
    cc: list[str] = Field(default_factory=list)
    reply_to_message_id: str | None = Field(None, description="Gmail message id to reply to (keeps the thread)")


@tool(name="email_create_draft", description="Create an e-mail draft (nothing is sent).", risk=Risk.WRITE,
      activity="Пишу черновик", idempotent=False, timeout_s=30)
async def email_create_draft(ctx: ToolContext, args: DraftArgs) -> dict:
    gmail = await _gmail(ctx)
    local = LocalDrafts(ctx.app, ctx.user_id)
    provider_ref = None
    thread_id = in_reply_to = None
    if gmail is not None:
        to = validate_addresses(args.to)
        cc = validate_addresses(args.cc) if args.cc else []
        if args.reply_to_message_id:
            orig = await gmail.read(args.reply_to_message_id)
            thread_id, in_reply_to = orig.get("thread_id"), orig.get("message_id_header")
        g = await gmail.create_draft(to=to, subject=args.subject, body=args.body, cc=cc, in_reply_to=in_reply_to,
                                     thread_id=thread_id)
        provider_ref = g["draft_id"]
    draft = await local.create(to=args.to, cc=args.cc, subject=args.subject, body=args.body,
                               provider="gmail" if gmail else "local", provider_ref=provider_ref,
                               in_reply_to=args.reply_to_message_id)
    return {"draft": {"id": str(draft.id), "to": draft.to, "cc": draft.cc, "subject": draft.subject,
                      "body": draft.body, "provider": draft.provider},
            "note": "draft saved in Gmail" if gmail else "saved locally — connect Gmail to send"}


class NoArgs(BaseModel):
    limit: int = Field(10, ge=1, le=50)


@tool(name="email_list_drafts", description="List recent drafts created by JARVIS.", activity="Смотрю черновики")
async def email_list_drafts(ctx: ToolContext, args: NoArgs) -> dict:
    rows = await LocalDrafts(ctx.app, ctx.user_id).list(args.limit)
    return {"drafts": [{"id": str(d.id), "to": d.to, "subject": d.subject, "status": d.status,
                        "provider": d.provider} for d in rows]}


class SendArgs(BaseModel):
    draft_id: str = Field(description="Id returned by email_create_draft")


def _send_summary(a: dict) -> str:
    return f"Отправить письмо (черновик {str(a.get('draft_id'))[:8]})"


@tool(name="email_send_draft", description="Send a previously created draft. Requires the user's confirmation.",
      risk=Risk.EXTERNAL, activity="Отправляю письмо", idempotent=False, timeout_s=45, summarize=_send_summary)
async def email_send_draft(ctx: ToolContext, args: SendArgs) -> dict:
    local = LocalDrafts(ctx.app, ctx.user_id)
    draft = await local.get(args.draft_id)
    if draft.status == "sent":
        return {"already_sent": True, "draft_id": args.draft_id}
    gmail = await _gmail(ctx)
    if gmail is None or draft.provider != "gmail" or not draft.provider_ref:
        raise ToolError("this draft cannot be sent: no connected mailbox",
                        hint="connect Google in Integrations, then recreate the draft")
    sent = await gmail.send_draft(draft.provider_ref)
    await local.mark_sent(args.draft_id, sent.get("message_id"))
    return {"sent": True, "to": draft.to, "subject": draft.subject, **sent}


class ArchiveArgs(BaseModel):
    message_ids: list[str] = Field(min_length=1, max_length=100)
    mark_read: bool = True


@tool(name="email_archive", description="Archive messages (remove from inbox), optionally marking them read.",
      risk=Risk.WRITE, activity="Архивирую письма", timeout_s=60)
async def email_archive(ctx: ToolContext, args: ArchiveArgs) -> dict:
    gmail = await _gmail(ctx)
    if gmail is None:
        raise ToolError("no mailbox connected")
    remove = ["INBOX"] + (["UNREAD"] if args.mark_read else [])
    done = [await gmail.modify(mid, [], remove) for mid in args.message_ids]
    return {"archived": len(done)}
