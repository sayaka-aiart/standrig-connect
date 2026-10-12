# 表情・母音 / Expressions and visemes

StandRig本体で表情と口形を登録し、**画像込みモデル（.srig）**を書き出します。Connectの「モデル」で読み込むと「表情・母音」タブから再生できます。既存の画像込み `.json` も対応します。登録データのないモデルは従来どおり再生できますが、表情・母音の選択はできません。

Connectは登録済みのデータを再生します。登録・編集と `.exp3.json` の読込・書出しは[StandRig本体](https://github.com/sayaka-aiart/StandRig/blob/main/docs/FACIAL.md)で行います。登録だけで未作成の口メッシュやキーフォームが生成されることはありません。表情はAdd／Multiply／Overwriteとフェード、母音は絶対値の口形と作成済みBlend Shape用パラメータの両方に対応します。Cubism SDKと完全一致する評価を保証するものではありません。

## アプリでの操作

- 表情を選び「表情を適用」。強度スライダーは選択した表情をその強度で適用します。表情の切り替え・解除は登録した時間でフェードします。
- 「あ・い・う・え・お・無音」は登録済みの項目のみ使用できます。無音は登録した口形を適用し、「母音を解除」は現在の追従・モーション入力へ戻します。
- 「表情・母音をすべて解除」は両方を即時解除します。片方のみの解除もできます。

通常入力 → トラッキング → 待機の加算 → 読込モーション → 表情 → 母音 → 数値API上書き → 物理 → 描画の順です。表情・母音は毎フレーム新しい入力に適用し、前フレームの結果へ累積しません。Multiplyの半目は瞬きと併用できます。Overwriteの目開きは追従より優先されます。母音は登録した口の項目で表情より優先します。数値APIの上書きが期限切れになると、選択中の表情・母音も反映した現在の入力に戻ります。

表情・母音の選択は解除またはモデル切替・描画停止まで継続します。モーションの一時停止・停止では解除しません。操作画面の最小化・トレイ格納中もフェードと再生を継続し、同じ描画結果をOBS／Spout2へ出力します。スロットは登録データを含むモデルを保存しますが、再生中の選択・強度は保存しません。

## HTTP API

既存[パラメータAPI](PARAMETER-API.md)と同じ `http://127.0.0.1:22036`、Bearer認証、ループバック限定の接続を使用します。認証情報は `%LOCALAPPDATA%\StandRigConnect\api-session.json`。全リクエストで認証が必要です。本体サービスの起動は不要です。

### GET `/api/v1/facial`

`modelSession`、`presets`（`facialPresets`と同じ登録一覧）、`state`（`expressionId`・各レイヤーの現在の重み・`transitioning`）、`acceptedSequence`、`appliedSequence`、`pending`、`error`を返します。描画モデルがない場合はセッション・一覧・状態がnullです。状態は描画スレッドから約10Hzで公開し、指示反映時にも更新します。描画自体の更新頻度を制限するものではありません。

### POST `/api/v1/facial`

`Content-Type: application/json`。外側のオブジェクトには以下の2項目だけを指定します。内側の `command` はStandRig本体と同じ形式です。

```json
{"modelSession":"GETで取得したID","command":{"action":"expression","id":"smile","strength":1}}
```

| command | 動作 |
| --- | --- |
| `{"action":"expression","id":"smile","strength":0.5}` | 表情を選択。省略時の強度は1 |
| `{"action":"viseme","id":"A","strength":1}` | 登録済み母音を選択 |
| `{"action":"visemes","weights":{"A":0.6,"I":0.4}}` | 登録済み母音を混合 |
| `{"action":"clear","layer":"expression"}` | 表情だけフェード解除 |
| `{"action":"clear","layer":"viseme"}` | 母音だけフェード解除 |
| `{"action":"clear","immediate":true}` | 両方を即時解除 |

母音IDは `A` / `I` / `U` / `E` / `O` / `Silence`。強度・各重みは有限数の0～1です。重みの合計が1を超える場合は正規化し、1未満の残りは現在の入力から補います。空または全ゼロの重みは母音を解除します。未登録ID、未知・重複フィールド、文字列の数値、範囲外の値は拒否し、既存状態を維持します。

成功は **202 Accepted** と `{accepted:true,modelSession,sequence}`。これは受付であり、描画への反映完了ではありません。描画スレッドが順番に処理し、GETの `appliedSequence` と `state` で反映を確認します。`error` は描画側の指示処理エラーです。キューは最大32件で、満杯なら429を返すため少し待って再試行します。全クライアントとUIで1つのキューを共有し、後から反映した指示が選択状態を更新します。

モデル切替後は一覧と `modelSession` を再取得してください。古いセッション／モデル未読込は409、形式不正は400、認証なしは401、ブラウザOriginなどは禁止403、本文32KiB超は413です。表情APIにTTLはありません。数値APIのTTLとは異なり、選択は解除まで継続します。モデルやスロットへの永続編集は行いません。

## Python例

Python標準ライブラリだけで、最初の登録表情を選択します。モデルに登録済みのIDを使い、認証情報をログへ出さないでください。

```python
import json, os
from pathlib import Path
from urllib.request import Request, urlopen

credentials = json.loads((Path(os.environ["LOCALAPPDATA"]) / "StandRigConnect" / "api-session.json").read_text(encoding="utf-8"))
def request(path, body=None):
    headers = {"Authorization": "Bearer " + credentials["token"]}
    data = None if body is None else json.dumps(body).encode("utf-8")
    if data is not None:
        headers["Content-Type"] = "application/json"
    with urlopen(Request(credentials["url"] + path, data=data, headers=headers), timeout=5) as response:
        return json.load(response)

facial = request("/api/v1/facial")
if not facial["modelSession"] or not facial["presets"]["expressions"]:
    raise RuntimeError("Load a model with registered expressions first")
request("/api/v1/facial", {
    "modelSession": facial["modelSession"],
    "command": {"action": "expression", "id": facial["presets"]["expressions"][0]["id"]}
})
# To release later:
# request("/api/v1/facial", {"modelSession": facial["modelSession"], "command": {"action": "clear"}})
```

## English

Author expressions and vowel poses in StandRig, export an embedded-image `.srig`, then open it in Connect. The `表情・母音` tab selects an expression, previews its strength, selects registered A/I/U/E/O/Silence targets and clears either or both layers. Registration and exp3 interchange belong to StandRig; Connect does not create missing mouth deformations or import exp3 directly. Both pose and authored Blend Shape banks are supported through the shared StandRig controller, with no claim of exact Cubism SDK parity.

Order: base → tracking → additive idle → motion → expressions → visemes → explicit numeric API overrides → physics → rendering. Evaluate from fresh input every frame. Clearing restores the current underlying input. Model switch/render stop clears the facial session; motion pause/stop does not. Facial selection persists until cleared, including while minimized/in the tray. Slots preserve the catalog but do not remember transient selections.

The authenticated loopback API shares parameter API credentials. GET `/api/v1/facial` discovers catalog, model session, current weights and queue progress. POST accepts `{modelSession,command}` using the command table above and returns **202** with a sequence number; processing occurs on the renderer thread. Inspect GET state/appliedSequence/error for actual application. Maximum queue size is 32 (429 when full); maximum body is 32 KiB. Unknown fields, duplicate keys, unregistered IDs and nonfinite/out-of-range numbers are rejected. Strength/weights are [0,1]; mixtures above 1 are normalized. Below 1 leaves live input contribution. Unlike numeric overrides, facial commands have no TTL. Model changes require rediscovery (stale/no model 409). No rig/slot writes occur.

Audio analysis, delay compensation, built-in global hotkeys and a dedicated Stream Deck plugin are not included. Scripts or HTTP actions can use this API as their input boundary. The Python example uses only the standard library. No StandRig service is required during playback.
