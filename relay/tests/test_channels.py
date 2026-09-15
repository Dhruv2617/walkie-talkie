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
    assert resp.json()["error"] == "role_taken"


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
