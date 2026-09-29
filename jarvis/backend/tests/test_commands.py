"""Custom commands: trigger normalisation and step shapes (unit), plus the full run (integration)."""

import pytest
from pydantic import ValidationError

from jarvis.commands.service import CommandIn, Step, normalize


def test_trigger_normalisation_ignores_wake_word_case_and_punctuation():
    assert normalize("JARVIS, включи игровой режим!") == "включи игровой режим"
    assert normalize("Hey Jarvis — Gaming Mode.") == "gaming mode"
    assert normalize("Джарвис: Доброе Утро") == "доброе утро"
    assert normalize("  ёлка  ") == "елка"


def test_step_shapes_are_validated():
    assert Step(type="wait", seconds=2).seconds == 2
    with pytest.raises(ValidationError):
        Step(type="wait")
    with pytest.raises(ValidationError):
        Step(type="wait", seconds=500)  # max 2 minutes
    with pytest.raises(ValidationError):
        Step(type="tool")
    with pytest.raises(ValidationError):
        Step(type="say", text="  ")
    with pytest.raises(ValidationError):
        CommandIn(name="x", triggers=[], steps=[Step(type="say", text="hi")])


@pytest.mark.integration
async def test_gaming_mode_runs_steps_in_order_and_reports_honestly(app, user):
    from jarvis.commands.service import CommandError
    from jarvis.db.models import Task
    from jarvis.testing import run_tasks

    body = CommandIn(name="Gaming Mode", triggers=["игровой режим", "gaming mode"], response="Игровой режим активирован.",
                     steps=[Step(type="tool", tool="time_now", args={}), Step(type="wait", seconds=0.1),
                            Step(type="tool", tool="weather_forecast", args={"location": "x"}, when="weekend",
                                 continue_on_error=True),
                            Step(type="say", text="Поехали")])
    cmd, warnings = await app.commands.save(user.id, body, elevated=False)
    assert warnings == []
    with pytest.raises(CommandError, match="already used"):
        await app.commands.save(user.id, CommandIn(name="Other", triggers=["Gaming mode!"],
                                                   steps=[Step(type="say", text="x")]), elevated=False)
    with pytest.raises(CommandError, match="cannot be used inside a command"):
        await app.commands.save(user.id, CommandIn(name="Loop", triggers=["loop"],
                                                   steps=[Step(type="tool", tool="command_run", args={"name": "x"})]),
                                elevated=False)
    msg, task = await app.conversations.submit(user_id=user.id, text="JARVIS, игровой режим!")
    assert task.kind == "command_run"  # matched without calling the model
    await run_tasks(app)
    async with app.sessionmaker() as s:
        done = await s.get(Task, task.id)
    assert done.status == "succeeded" and done.result["status"] == "ok"
    assert done.result["text"] == "Игровой режим активирован."
