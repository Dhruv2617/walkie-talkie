def test_create_channel_returns_id_and_secret(client, fake_redis):
    resp = client.post("/channels")
    assert resp.status_code == 201
    body = resp.json()
    assert "channel_id" in body
    assert "secret" in body
    assert fake_redis.get(f"channel:{body['channel_id']}:secret") == body["secret"]


def test_join_claims_first_free_slot(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.post(
        f"/channels/{created['channel_id']}/join",
        json={"secret": created["secret"]},
    )
    assert resp.status_code == 201
    assert resp.json()["slot"] == "buddy1"
    assert fake_redis.ttl(f"channel:{created['channel_id']}:online:buddy1") > 0


def test_second_join_gets_the_other_slot(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    first = client.post(f"/channels/{channel_id}/join", json={"secret": secret})
    second = client.post(f"/channels/{channel_id}/join", json={"secret": secret})

    assert first.json()["slot"] == "buddy1"
    assert second.json()["slot"] == "buddy2"


def test_join_rejects_when_channel_full(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret})
    client.post(f"/channels/{channel_id}/join", json={"secret": secret})

    resp = client.post(f"/channels/{channel_id}/join", json={"secret": secret})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "channel_full"


def test_join_rejects_wrong_secret(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.post(
        f"/channels/{created['channel_id']}/join",
        json={"secret": "wrong"},
    )
    assert resp.status_code == 403


def test_join_is_atomic_under_concurrent_claims(client, fake_redis):
    # Fire many concurrent join requests for the same channel and prove
    # exactly two succeed (one per slot) — this is what would fail under a
    # check-then-set race.
    import concurrent.futures

    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    def attempt_join():
        return client.post(f"/channels/{channel_id}/join", json={"secret": secret})

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        responses = list(pool.map(lambda _: attempt_join(), range(20)))

    statuses = [r.status_code for r in responses]
    assert statuses.count(201) == 2
    assert statuses.count(409) == 18

    slots = sorted(r.json()["slot"] for r in responses if r.status_code == 201)
    assert slots == ["buddy1", "buddy2"]


def test_presence_true_when_joined(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret})

    resp = client.get(f"/channels/{channel_id}/presence/buddy1", params={"secret": secret})
    assert resp.json() == {"online": True}


def test_presence_false_when_not_joined(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.get(
        f"/channels/{created['channel_id']}/presence/buddy1",
        params={"secret": created["secret"]},
    )
    assert resp.json() == {"online": False}


def test_presence_requires_secret(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.get(f"/channels/{created['channel_id']}/presence/buddy1")
    assert resp.status_code == 422


def test_presence_rejects_wrong_secret(client, fake_redis):
    created = client.post("/channels").json()
    resp = client.get(
        f"/channels/{created['channel_id']}/presence/buddy1",
        params={"secret": "wrong"},
    )
    assert resp.status_code == 403


def test_push_message_returns_incrementing_id(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    first = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "buddy1", "type": "fyi", "text": "hello"},
    )
    second = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "buddy1", "type": "fyi", "text": "again"},
    )
    assert first.json()["id"] == 1
    assert second.json()["id"] == 2


def test_push_message_round_trips_from_field(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    resp = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "buddy1", "type": "fyi", "text": "hello"},
    )
    assert resp.status_code == 201
    import json as _json

    raw = fake_redis.lrange(f"channel:{channel_id}:messages", 0, -1)
    stored = _json.loads(raw[-1])
    assert stored['from'] == 'buddy1'
    assert stored["id"] == resp.json()["id"]


def test_push_trims_to_last_50(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    for i in range(55):
        client.post(
            f"/channels/{channel_id}/messages",
            json={"secret": secret, "from": "buddy1", "type": "fyi", "text": f"msg {i}"},
        )

    assert fake_redis.llen(f"channel:{channel_id}:messages") == 50


def test_push_message_wrong_secret_returns_403(client, fake_redis):
    created = client.post("/channels").json()
    channel_id = created["channel_id"]

    resp = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": "wrong", "from": "buddy1", "type": "fyi", "text": "hello"},
    )
    assert resp.status_code == 403


def test_pull_returns_only_messages_after_since(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    for text in ["a", "b", "c"]:
        client.post(
            f"/channels/{channel_id}/messages",
            json={"secret": secret, "from": "buddy1", "type": "fyi", "text": text},
        )

    resp = client.get(f"/channels/{channel_id}/messages", params={"since": 1, "secret": secret})
    texts = [m["text"] for m in resp.json()["messages"]]
    assert texts == ["b", "c"]


def test_pull_requires_secret(client, fake_redis):
    created = client.post("/channels").json()
    channel_id = created["channel_id"]
    resp = client.get(f"/channels/{channel_id}/messages")
    assert resp.status_code == 422


def test_pull_rejects_wrong_secret(client, fake_redis):
    created = client.post("/channels").json()
    channel_id = created["channel_id"]
    resp = client.get(f"/channels/{channel_id}/messages", params={"secret": "wrong"})
    assert resp.status_code == 403


def test_heartbeat_returns_404_when_slot_not_claimed(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    resp = client.post(
        f"/channels/{channel_id}/heartbeat",
        json={"secret": secret, "slot": "buddy1"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "not_claimed"


def test_heartbeat_succeeds_when_claimed(client, fake_redis):
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]
    client.post(f"/channels/{channel_id}/join", json={"secret": secret})

    resp = client.post(
        f"/channels/{channel_id}/heartbeat",
        json={"secret": secret, "slot": "buddy1"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
