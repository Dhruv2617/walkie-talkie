"""End-to-end test exercising the real HTTP flow across all routes together.

Uses the FastAPI TestClient directly against the real app (with fakeredis
standing in for Redis) rather than spawning the CLI as a subprocess: this
proves the routes compose correctly for a full two-slot session (the thing
no per-layer test currently proves), for much less effort and flakiness than
a true process-spawn CLI e2e, while still exercising the actual ASGI app end
to end rather than a stub.
"""


def test_full_channel_lifecycle(client, fake_redis):
    # create channel
    created = client.post("/channels").json()
    channel_id, secret = created["channel_id"], created["secret"]

    # two sessions join and get assigned the two distinct slots
    join_1 = client.post(f"/channels/{channel_id}/join", json={"secret": secret})
    join_2 = client.post(f"/channels/{channel_id}/join", json={"secret": secret})
    assert join_1.status_code == 201
    assert join_2.status_code == 201
    slot_1, slot_2 = join_1.json()["slot"], join_2.json()["slot"]
    assert {slot_1, slot_2} == {"buddy1", "buddy2"}

    # both should be online
    for slot in (slot_1, slot_2):
        resp = client.get(f"/channels/{channel_id}/presence/{slot}", params={"secret": secret})
        assert resp.json() == {"online": True}

    # slot_1 pushes an fyi
    fyi = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": slot_1, "type": "fyi", "text": "starting work"},
    )
    assert fyi.status_code == 201
    fyi_id = fyi.json()["id"]

    # slot_2 pulls and sees the fyi
    pulled = client.get(
        f"/channels/{channel_id}/messages", params={"secret": secret, "since": 0}
    ).json()["messages"]
    assert [m["text"] for m in pulled] == ["starting work"]
    assert pulled[0]["id"] == fyi_id

    # slot_2 pushes a question
    question = client.post(
        f"/channels/{channel_id}/messages",
        json={"secret": secret, "from": slot_2, "type": "question", "text": "decimals ok?"},
    )
    assert question.status_code == 201
    question_id = question.json()["id"]

    # slot_1 pushes an answer replying to that question
    answer = client.post(
        f"/channels/{channel_id}/messages",
        json={
            "secret": secret,
            "from": slot_1,
            "type": "answer",
            "text": "integer only",
            "reply_to": question_id,
        },
    )
    assert answer.status_code == 201

    # slot_2 pulls since the question and finds the matching answer
    since_question = client.get(
        f"/channels/{channel_id}/messages",
        params={"secret": secret, "since": question_id - 1},
    ).json()["messages"]
    match = next(
        m for m in since_question if m["type"] == "answer" and m["reply_to"] == question_id
    )
    assert match["text"] == "integer only"

    # heartbeat keeps presence alive for a claimed slot
    hb = client.post(
        f"/channels/{channel_id}/heartbeat", json={"secret": secret, "slot": slot_1}
    )
    assert hb.status_code == 200

    # wrong secret is rejected on every guarded route
    assert client.get(
        f"/channels/{channel_id}/messages", params={"secret": "wrong"}
    ).status_code == 403
    assert client.get(
        f"/channels/{channel_id}/presence/{slot_1}", params={"secret": "wrong"}
    ).status_code == 403
