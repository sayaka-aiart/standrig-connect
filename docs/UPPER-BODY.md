# 上半身トラッキング / Upper-body tracking

試験機能です。顔推論に加えて、肩の奥行き差を `ParamBodyAngleX`、肩の傾きを `ParamBodyAngleZ` へ入力します。モデル側に対応するリグが必要です。身体の上下傾きは肩と腰の奥行き差から `ParamBodyAngleY` へ入力します。平行移動・腕・全身追従は未対応です。

ビルド後、リポジトリ直下で実行します。

```powershell
powershell -NoProfile -File scripts/setup-native-inference.ps1 -WithUpperBody
```

「配信」で顔認識と「上半身（開始時に適用）」をONにしてカメラを開始します。切替後はカメラを再開始してください。両肩が映る位置で正面を向いて中立校正し、トラッキング調整の体・左右／体・傾きで調整します。上半身ON/OFFはスロットには保存しません。既存スロットには、対応パラメーターがあり入力・出力が未割当の場合に傾き設定を追加します。

固定版MediaPipe Pose Landmarker Liteをカメラワーカー内で最大約15Hz、顔推論と順番に実行します。追加負荷で顔の更新頻度も下がる場合があります。低信頼度や画面外の肩は採用せず、短時間保持後に入力の中立値へなめらかに戻します。OFFでは従来の顔からの身体推定を使用します。

自動テストと推論モデルの起動確認は済んでいます。実カメラでの方向・精度・負荷は未確認です。

## English

Experimental shoulder yaw and roll drive `ParamBodyAngleX` and `ParamBodyAngleZ`. Body pitch uses shoulder-to-hip depth and drives `ParamBodyAngleY`. Translation, arms and full-body tracking are not implemented.

After building, run the setup command above. Enable face inference and **上半身（開始時に適用）** in Streaming, then start/restart the camera. Keep both shoulders visible and calibrate neutral. Adjust body yaw/roll gain and inversion in tracking settings. The upper-body switch is not saved in slots. Older slots gain a roll mapping only if the model supports it and neither its input nor output is already assigned.

Pose inference runs sequentially with face inference in the camera worker at most approximately 15Hz. Additional work may reduce face update frequency. Low-confidence and off-screen shoulders are rejected, briefly held, then eased toward neutral input. Automated tests and native inference initialization pass; live-camera direction, quality and performance remain unverified.

## Model provenance

[Official Pose Landmarker documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).
Lite float16 version 1, downloaded separately; not bundled with source.
SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
Redistribution review for bundled models remains separate.

顔Yの標準倍率は30、身体Yは20です。既存のConnect標準スロットは倍率比率を保って一度だけ更新します（独自名のプロファイルは維持）。上半身は起動時ONです。身体Yには両肩と腰が映る画角が必要で、腰未検出時は身体Yのみ保持後に戻します。更新後は正面姿勢で中立校正をやり直してください。

Default face/body pitch gains are 30/20. Existing Connect standard profiles upgrade once while preserving relative gains; custom-named profiles are unchanged. Upper-body tracking defaults to ON. Pitch requires visible shoulders and hips; missing hips hold then release pitch only. Recalibrate neutral after updating.
