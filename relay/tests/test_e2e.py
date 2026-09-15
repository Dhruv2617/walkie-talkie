"""End-to-end test exercising the real HTTP flow across all routes together.

Uses the FastAPI TestClient directly against the real app (with fakeredis
standing in for Redis) rather than spawning the CLI as a subprocess: this
proves the routes compose correctly for a full backend<->frontend session
(the thing no per-layer test currently proves), for much less effort and
flakiness than a true process-spawn CLI e2e, while still exercising the
actual ASGI app end to end rather than a stub.
"""


def test_full_channel_lifecycle(client, fake_redis):
    # create channel
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    # join as backend and frontend
    assert client.post(
        f"/channels/{channel_id}/join", json={"secret": secret, "role": "backend"}
    ).status_code == 201
    assert client.post(
        f"/channels/{channel_id}/join", json={"secret": secret, "role": "frontend"}
    ).status_code == 201

    # both should be online
    for role in ("backend", "frontend"):
        resp = client.get(f"/channels/{channel_id}/presence/{role}", params={"secret": secret})
        assert resp.json() == {"online": True}

    # backend pushes an fyi
    fyi = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "backend", "type": "fyi", "text": "starting work"},
    )
    assert fyi.status_code == 201
    fyi_id = fyi.json()["id"]

    # frontend pulls and sees the fyi
    pulled = client.get(
        f"/channels/{channel_id}/messages", params={"secret": secret, "since": 0}
    ).json()["messages"]
    assert [m["text"] for m in pulled] == ["starting work"]
    assert pulled[0]["id"] == fyi_id

    # frontend pushes a question
    question = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": "frontend", "type": "question", "text": "decimals ok?"},
    )
    assert question.status_code == 201
    question_id = question.json()["id"]

    # backend pushes an answer replying to that question
    answer = client.post(
        f"/channels/{channel_id}/messages",
        json={
            "secret": secret,
            "from": "backend",
            "type": "answer",
            "text": "integer only",
            "reply_to": question_id,
        },
    )
    assert answer.status_code == 201

    # frontend pulls since the question and finds the matching answer
    since_question = client.get(
        f"/channels/{channel_id}/messages",
        params={"secret": secret, "since": question_id - 1},
    ).json()["messages"]
    match = next(
        m for m in since_question if m["type"] == "answer" and m["reply_to"] == question_id
    )
    assert match["text"] == "integer only"

    # heartbeat keeps presence alive for a claimed role
    hb = client.post(
        f"/channels/{channel_id}/heartbeat", json={"secret": secret, "role": "backend"}
    )
    assert hb.status_code == 200

    # wrong secret is rejected on every guarded route
    assert client.get(
        f"/channels/{channel_id}/messages", params={"secret": "wrong"}
    ).status_code == 403
    assert client.get(
        f"/channels/{channel_id}/presence/backend", params={"secret": "wrong"}
    ).status_code == 403
