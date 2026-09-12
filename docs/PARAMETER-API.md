# Parameter API / パラメータ操作API

Connect starts a local HTTP API at `http://127.0.0.1:22036` during normal app startup. See the **API** tab for startup status and the credential-file location. No StandRig service is required. The server uses Kestrel and requires the ASP.NET Core 8 Runtime alongside the Windows Desktop runtime. Camera startup remains manual. The API continues while the control window is minimized/in the tray and stops when Connect exits.

通常起動時にローカルAPIを開始します。ポート使用中などで失敗した場合はAPIタブに表示し、モデル再生は引き続き利用できます。複数のConnectを同時起動しないでください。通常は管理者権限やURL予約の設定は不要です。LAN公開・ブラウザからの直接呼出しには対応しません。

## Authentication and discovery

Read `%LOCALAPPDATA%\StandRigConnect\api-session.json`. It contains `apiVersion: 1`, `url`, and `token`. Every request requires `Authorization: Bearer <token>`. Do not share or commit this file. The token changes after restart; reread the file. No token is printed in the UI or examples. Only loopback clients are accepted; requests with an Origin header are rejected, and there is no CORS access.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/parameters` | Model session, parameter IDs/min/max/default, latest renderer input and active overrides |
| POST | `/api/v1/parameters/set` | Atomically set temporary parameter overrides |
| POST | `/api/v1/parameters/clear` | Clear selected overrides, or all overrides |

The GET result uses `modelSession`, `parameters`, `inputValues`, `overrides`. With no model loaded, modelSession is null and the collections are empty. inputValues are the most recent renderer input before physics, not a rendered-image confirmation. Expired overrides can disappear from GET before the next render tick updates inputValues.

## Set

Use the modelSession from GET and real parameter IDs/ranges from parameters:

```json
{
  "modelSession": "session-from-get",
  "values": {"ParamAngleX": 10},
  "ttlMs": 1000
}
```

Requires application/json. Values must be finite numbers within each parameter's declared range; unknown IDs, duplicate keys, unknown fields and invalid batches are rejected without partial application. 1–512 values per request; maximum request size 32KiB. ttlMs is an integer from 100 to 10000, default 1000. Renew before expiry for continuous input (for example, every 100ms with ttlMs=1000). This API does not permanently edit the rig or saved slot.

合成順は通常入力 → 待機 → カメラ追従 → 読込モーション → API上書き → モデル評価・物理です。APIが指定した項目だけを優先し、未指定の項目は追従を継続します。期限切れ・解除後はその時点の通常入力へ戻ります。値は直接切り替わり、API独自のフェードはありません。モデル切替・描画停止で上書きを破棄します。モデルごとのセッションIDが変わるため、切替後にGETし直してください。

Each parameter has its own lease. Repeated set refreshes only supplied parameters. Multiple clients share one override layer: the last accepted write to a parameter wins, and any authenticated client can clear it. There is no per-client ownership, sequence ordering, expression state, motion control or WebSocket endpoint in this first version. Await writes sequentially if ordering matters. A disconnected client cannot leave overrides active beyond the maximum ten-second lease.

## Clear

```json
{"modelSession":"session-from-get","ids":["ParamAngleX"]}
```

Omit ids to clear all. An empty array clears nothing. Success returns `{"accepted":true,"modelSession":"..."}`; this acknowledges acceptance, not a completed render. A stale modelSession or no loaded model returns 409. Invalid JSON/fields/ranges return 400, missing/incorrect credentials 401, disallowed origin/host 403, unsupported route/method 404, body timeout 408, oversized body 413 and wrong content type 415.

## Python example (standard library only)

Open a model in Connect first. This example moves the first parameter with a nonzero range briefly and restores normal input; no model file is changed.

```python
import json
import os
import time
import urllib.request
from pathlib import Path

session = json.loads((Path(os.environ["LOCALAPPDATA"]) / "StandRigConnect" / "api-session.json").read_text(encoding="utf-8"))

def call(path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(session["url"] + "/api/v1/parameters" + path, data=data,
        headers={"Authorization": "Bearer " + session["token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)

state = call("")
if state["modelSession"] is None:
    raise RuntimeError("Load a model in Connect first")
p = next(p for p in state["parameters"] if p["max"] > p["min"])
model = state["modelSession"]
value = min(p["max"], p["default"] + (p["max"] - p["min"]) * 0.1)
try:
    for _ in range(10):
        call("/set", {"modelSession": model, "values": {p["id"]: value}, "ttlMs": 1000})
        time.sleep(0.1)
finally:
    call("/clear", {"modelSession": model, "ids": [p["id"]]})
```

Stream Deck or other native tools can call the same endpoints through a script or HTTP action capable of reading credentials and modelSession. This is a parameter API, not yet a ready-made Stream Deck plugin or expression-hotkey feature.
