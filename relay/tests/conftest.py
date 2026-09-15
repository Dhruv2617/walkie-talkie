import fakeredis
import pytest
from fastapi.testclient import TestClient

from relay.app import redis_client
from relay.app.main import app


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    fake = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr(redis_client, "_client", fake)
    return fake


@pytest.fixture
def client():
    return TestClient(app)
