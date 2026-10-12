# 音声リップシンク / Audio lip sync

Connectの「リップシンク」タブで、録音入力からA/I/U/E/Oの口形を推定します。カメラによる口の追従とは別の機能です。uLipSyncのMFCC処理をUnityに依存しない.NET処理へ移植し、Windowsの録音入力にはNAudio.Wasapiを使用します。追加の学習済みモデル、Unity、Python、本体サービスは必要ありません。

## 最初の設定

1. StandRig本体でA/I/U/E/O/Silenceの口形をすべて登録し、画像込み `.srig` を書き出してConnectへ読み込みます。Silenceには閉じた口を登録します。登録のみで口の変形は作成されません。
2. 「リップシンク」で録音デバイスを選び、「音声入力を開始」。マイクまたはDAWからの仮想録音入力など、Windowsに録音デバイスとして見える経路を使います。
3. 「あ」「い」「う」「え」「お」を順に押し、その母音を約2秒ずつ発声します。最初の0.4秒は準備時間、続く1.2秒の声のある区間から特徴量を平均します。20区間以上を取得できた母音に✓が付きます。音声不足で失敗した場合は以前の校正を維持します。
4. 5母音の校正後、「音声で口を動かす」をONにします。入力開始だけではモデルへ適用しません。
5. 「音量・遅延を調整…」で入力の強さ・無音判定・最大開口の音量・口の反映遅延を調整します。小声が拾われない場合は無音判定を下げるか入力の強さを上げます。

録音デバイスの一覧はアプリ起動時に取得しますが、**音声入力・口への適用は毎回OFFで起動**します。入力開始後は操作画面の最小化・トレイ中も解析と描画を続けます。モデル変更・描画停止では自動適用をOFFにしますが、入力自体は独立して停止できます。入力を停止した場合、適用中の口は現在の通常入力に戻ります。音声が途切れた場合も適用を解除します。

Windowsのマイク権限・共有モードで使用できる録音機器が必要です。DAWのASIO専用バスやOBS内部バスへ直接接続する機能、再生デバイスのループバック録音は含みません。DAW側から利用可能な録音デバイスへルーティングしてください。Connectは音声をスピーカーやOBSに送らず、配信用音声の経路を変更しません。

## 校正と保存

音色を表す12個のMFCC係数を5母音分保存します。サンプル音声、汎用の声プロファイル、音声波形ファイルは同梱・保存しません。校正と設定はアプリ共通で `%LOCALAPPDATA%\StandRigConnect\lipsync-settings.json` に自動保存します。モデルスロットや `.srig` には含めません。声・マイク・DAW処理が変わった場合は再校正してください。「校正をリセット」で特徴量を消去できます。入力の開始状態は保存しません。

校正中はモデルへの音声適用をOFFにします。完了後は必要に応じて再びONにしてください。無音判定で除外した区間は校正に使いません。これは発話内容を文字起こしする機能ではなく、話者の校正値に最も近い音色を母音の重みとして求める方式です。子音・雑音・歌唱・伴奏を常に正確に分類することを保証するものではありません。

## 適用順と手動操作

音声は登録済み母音レイヤーを使い、カメラ・待機・モーションの口パラメータより優先します。無音時はSilenceを適用するので、カメラ側の開いた口には戻りません。音量に応じて母音とSilenceを混合します。表情レイヤーや目・体の追従は継続します。数値パラメータAPIの明示的上書きは音声より優先し、TTL切れで現在の音声口形に戻ります。

「表情・母音」タブや `/api/v1/facial` から母音の選択・混合・解除、または両レイヤーの解除を行うと、**音声の自動適用を停止して手動操作を優先**します。表情だけの選択・解除は音声と併用できます。再開するには「音声で口を動かす」をONにしてください。音声処理はHTTPキューへ連続投稿せず、描画スレッドで最新の重みを直接適用します。`appliedSequence`は手動API/UI指示の反映番号であり、音声更新の番号ではありません。

## 音声と映像の遅延

「口の反映を遅らせる」は**0～2000msの追加遅延**です。遅らせるのは口形だけで、音声・顔・体・OBS全体は遅らせません。設定を変更すると未反映の口形を捨て、古い口形を後から再生しません。

- **口が音声より先に動く**：Connect側で口の反映を遅らせます。
- **口が音声より遅い**：追加遅延を0にし、OBSの音声同期オフセットなどで配信用音声を遅らせます。Connectが未来の音声を予測して口を先行させる機能はありません。

MFCCの窓は64ms、更新間隔は20msです。初期窓の充足、録音機器・Windowsのバッファ、処理、モデルに登録した母音フェード、描画・OBSの遅延も加わります。このスライダーは自動同期や総遅延の実測値ではありません。実際に使う配信音声とOBS映像で調整してください。

## ライセンスと検証範囲

移植元のuLipSyncコードとNAudio本体はMITです。NAudioの完全なDLLには別の著作権・ライセンス通知を持つコードも含まれるため、[内包コードの通知](../licenses/NAUDIO-THIRD-PARTY-NOTICES.txt)を併せて保持します。独自の録音・校正・制御・UIコードはConnectのApache-2.0です。著作権・許諾文を [uLipSync](../licenses/ULIPSYNC-LICENSE.txt)・[NAudio](../licenses/NAUDIO-LICENSE.txt) として保持し、移植元コミットと元ファイルのSHA-256、変更内容を [provenance](../licenses/LIPSYNC-PROVENANCE.json) に記録しています。UnityChan素材・サンプル声・Unity/Burst DLL・追加の学習済みモデルは配布しません。

合成信号による独立数値参照との比較、PCMデコード・リサンプル・校正・無音・遅延・手動優先・ネイティブ描画・最小化中の処理・Spout2送信を検証します。実話者の推定精度と使用機器による遅延は、利用者の校正と実音声での確認が必要です。数値比較はUnity版との完全なバイナリ一致や実話者の認識精度を保証しません。

## English

Connect's `リップシンク` tab estimates A/I/U/E/O from Windows recording input. The MFCC stages are adapted from MIT-licensed uLipSync; capture uses NAudio.Wasapi/Core 2.2.1 (MIT for NAudio code, plus retained notices for other code inside the complete assemblies). No Unity, Python, pretrained model or StandRig service is needed. Register all A/I/U/E/O/Silence targets in StandRig first, export `.srig`, and load it in Connect. Silence should be a closed mouth.

Choose a recording endpoint and start input, then click each vowel and speak it for about two seconds. Calibration arms for 0.4 seconds and averages voiced features over 1.2 seconds; at least 20 accepted frames are required. Failed calibration preserves the previous template. After calibrating all five vowels, enable `音声で口を動かす`. Input and automatic application are OFF on every launch. Analysis and rendering continue while minimized/in the tray. Neither audio monitoring nor audio forwarding to OBS is implemented. DAW input must appear as a Windows capture endpoint; direct ASIO/OBS buses and render-device loopback are not included.

Only twelve coefficients per vowel and app-wide settings are automatically stored in `%LOCALAPPDATA%\StandRigConnect\lipsync-settings.json`. Raw audio is not recorded or uploaded. Settings do not belong to model slots or `.srig`; recalibrate after changing voice, microphone or DAW processing. Calibration suspends automatic model application. This is calibrated timbre matching, not transcription or guaranteed consonant/noise separation.

Audio occupies the viseme layer, blends quiet input toward Silence and coexists with expressions and other tracked channels. Explicit numeric overrides take precedence. Manual UI/API viseme or all-layer clear commands suspend audio application without overwriting the manual selection. Expression-only commands coexist. Model switch/render stop also disables application; capture has its own stop control. Missing audio releases the mouth. Facial API sequence numbers describe manual commands, not automatic audio updates.

Additional mouth delay is 0–2000ms. It delays mouth weights only. If the mouth leads, increase it; if the mouth lags, set it to 0 and delay broadcast audio in OBS. There is no automatic synchronization or prediction. The 64ms analysis window, 20ms hop, capture buffers, authored fades and OBS output contribute additional delay. Adjust using the actual broadcast path.

Preserve the supplied MIT licenses, copyright notices and provenance with source/binary distribution. Original Connect code remains Apache-2.0. No UnityChan assets, sample voices, Unity runtime libraries or additional model weights are included. Synthetic/reference and native rendering checks are separate from actual speaker accuracy and device-specific latency validation.
