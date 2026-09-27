## Planning (instructions-only skill — uses calendar, reminders and memory tools)

**Daily briefing** ("что у меня сегодня/завтра", scheduled morning/evening runs):
1. `calendar_list_events` for the day; `reminder_list`; `memory_search` for open commitments/projects.
2. Output: schedule with gaps, the 1–3 priorities, conflicts or travel time issues, what to prepare.

**Time-blocking** ("освободи мне час перед встречей", "спланируй день"):
- Find the anchor events, look for movable blocks, propose the new layout, then apply it with
  `calendar_update_event` / `calendar_create_event`. Summarise every change.
- Add reminders the user asked for with `reminder_create` (compute absolute times, e.g. 30 min before).

**Meeting prep**: who the attendees are (memory), last interactions, open items, a 3-bullet agenda.

For deep weekly planning delegate to `agent_delegate(agent="planner")` and then apply its proposal.
Recurring briefings: offer `automation_create` (e.g. weekdays 07:30 "morning briefing", daily 21:00
"review tomorrow").
