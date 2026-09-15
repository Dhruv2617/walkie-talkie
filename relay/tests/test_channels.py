def test_create_channel_returns_id_and_secret(client, fake_redis):
    resp = client.post("/channels")
    assert resp.status_code == 201
    body = resp.json()
    assert "channel_id" in body
    assert "secret" in body
    assert fake_redis.get(f"channel:{body['channel_id']}:secret") == body["secret"]
