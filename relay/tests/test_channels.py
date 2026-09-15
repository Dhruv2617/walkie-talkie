def test_create_channel_returns_id_and_secret(client, fake_redis):
    resp = client.post("/channels")
    assert resp.status_code == 201
    body = resp.json()
    assert "channel_id" in body
    assert "secret" in body
    assert fake_redis.get(f"channel:{body['channel_id']}:secret") == body["secret"]


def test_join_claims_role(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.post(
        f"/channels/{created['channel_id']}/join",
        json={"secret": created["secret"], "role": "backend"},
    )
    assert resp.status_code == 201
    assert fake_redis.ttl(f"channel:{created['channel_id']}:online:backend") > 0


def test_join_rejects_when_role_already_held(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"})

    resp = client.post(f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "role_taken"


def test_join_rejects_wrong_secret(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.post(
        f"/channels/{created['channel_id']}/join",
        json={"secret": "wrong", "role": "backend"},
    )
    assert resp.status_code == 403


def test_join_is_atomic_under_concurrent_claims(client, fake_redis):
    # Fire many concurrent join requests for the same role and prove exactly
    # one succeeds — this is what would fail under a check-then-set race.
    import concurrent.futures

    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    def attempt_join():
        return client.post(
            f"/channels/{channel_id}/join",
            json={"secret": secret, "role": "backend"},
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        responses = list(pool.map(lambda _: attempt_join(), range(20)))

    statuses = [r.status_code for r in responses]
    assert statuses.count(201) == 1
    assert statuses.count(409) == 19


def test_presence_true_when_joined(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"})

    resp = client.get(f"/channels/{channel_id}/presence/backend")
    assert resp.json() == {"online": True}


def test_presence_false_when_not_joined(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.get(f"/channels/{created['channel_id']}/presence/backend")
    assert resp.json() == {"online": False}


def test_push_message_returns_incrementing_id(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    first = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "backend", "type": "fyi", "text": "hello"},
    )
    second = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "backend", "type": "fyi", "text": "again"},
    )
    assert first.json()["id"] == 1
    assert second.json()["id"] == 2


def test_push_message_round_trips_from_field(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    resp = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "backend", "type": "fyi", "text": "hello"},
    )
    assert resp.status_code == 201
    import json as _json

    raw = fake_redis.lrange(f"channel:{channel_id}:messages", 0, -1)
    stored = _json.loads(raw[-1])
    assert stored["from"] == "backend"
    assert stored["id"] == resp.json()["id"]


def test_push_trims_to_last_50(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    for i in range(55):
        client.post(
            f"/channels/{channel_id}/messages",
            json={"secret": secret, "from": "backend", "type": "fyi", "text": f"msg {i}"},
        )

    assert fake_redis.llen(f"channel:{channel_id}:messages") == 50


def test_push_message_wrong_secret_returns_403(client, fake_redis):
    created = client.post("/channels").json()
    channel_id = created["channel_id"]

    resp = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": "wrong", "from": "backend", "type": "fyi", "text": "hello"},
    )
    assert resp.status_code == 403


def test_pull_returns_only_messages_after_since(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    for text in ["a", "b", "c"]:
        client.post(
            f"/channels/{channel_id}/messages",
            json={"secret": secret, "from": "backend", "type": "fyi", "text": text},
        )

    resp = client.get(f"/channels/{channel_id}/messages", params={"since": 1})
    texts = [m["text"] for m in resp.json()["messages"]]
    assert texts == ["b", "c"]
