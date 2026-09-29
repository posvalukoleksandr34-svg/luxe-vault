"""Accounts never see each other's files: owner = root minus tenants/, everyone else = tenants/<id>."""

import uuid

import pytest

from jarvis.integrations.files import FileStore
from jarvis.tools.base import ToolError


def test_tenant_workspaces_are_isolated(tmp_path):
    owner = FileStore(tmp_path)
    alice, bob = owner.for_tenant(uuid.uuid4()), owner.for_tenant(uuid.uuid4())
    alice.write_text("notes/secret.txt", "alice only")
    owner.write_text("mine.txt", "owner")
    assert [i["path"] for i in bob.list("")] == []
    with pytest.raises(ToolError):
        bob.path("../" + alice.root.name + "/notes/secret.txt")
    with pytest.raises(ToolError):
        owner.path("tenants/" + alice.root.name + "/notes/secret.txt")
    assert [i["path"] for i in owner.list("", recursive=True)] == ["mine.txt"]
    assert owner.search("alice") == [] and alice.search("alice")[0]["path"] == "notes/secret.txt"
