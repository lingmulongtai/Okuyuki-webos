# プロトコル v2（テレビ向け）

スマホの Okuyuki-android が提供する HTTP ホストのうち、テレビアプリが使う部分です。v1（Quest 版）はそのまま残ります。
`fixtures/v2/` の JSON は Okuyuki-android の `core/protocol/src/test/resources/fixtures/v2/` と同じ内容に保ち、両方のテストで読み込みます。

## 接続の手順

1. `GET /v1/hello` で `protocolVersions` に 2 が含まれることを確かめる（[hello.json](fixtures/v2/hello.json)）。
2. 保存済みのトークンがなければ `POST /v1/pair` で承認を求める（[pair-request.json](fixtures/v2/pair-request.json)）。`requestId` を付けて同じ要求を 1 秒ごとに送り、`state` が `approved` になったら `token` を保存する。`rejected` と `expired` は終了。
3. `POST /v2/session` に `Authorization: Bearer <token>` を付けてメディアキーを受け取る（[session.json](fixtures/v2/session.json)）。401 ならトークンを捨てて 2 に戻る。
4. `POST /v2/k/{key}/capabilities` でテレビの画面と再生できる形式を伝える（[capabilities.json](fixtures/v2/capabilities.json)）。
5. 一覧、画像、動画、イベントはすべて `/v2/k/{key}/...` で取得する。キーが失効すると 401 になるので、3 からやり直す。

## エンドポイント

| メソッド | パス | 応答 |
| --- | --- | --- |
| POST | `/v2/session` | `{ key, expiresAt }`。キーは 128bit の乱数（base64url）、`expiresAt` は UNIX 時刻（ミリ秒） |
| POST | `/v2/k/{key}/capabilities` | 204 |
| GET | `/v2/k/{key}/library?filter=all\|photo\|video\|stereo&cursor=` | `{ items, next, total }`。新しい順に最大 60 件。`next` は次のページのカーソル（最後は `null`） |
| GET | `/v2/k/{key}/items/{id}` | `Item`（[item.json](fixtures/v2/item.json)） |
| GET | `/v2/k/{key}/items/{id}/thumb` | JPEG。長辺 480px |
| GET | `/v2/k/{key}/items/{id}/display` | JPEG。1920×1080 に収める。動画は代表フレーム |
| POST | `/v2/k/{key}/items/{id}/prepare?target=still\|video` | `Prepared`（下記） |
| GET | `/v2/k/{key}/items/{id}/still` | 4K の静止画動画。Range 対応 |
| GET | `/v2/k/{key}/items/{id}/video` | 動画。元ファイルか変換版。Range 対応 |
| WS | `/v2/k/{key}/events` | イベント（下記） |

`Item.hdr` は `none`、`ultrahdr`、`hdr10`、`hlg`、`hdr10plus` のどれか。`durationMs` は動画だけに入り、写真は `null` です。

**Prepared**: `state` は `ready`、`preparing`、`unsupported`、`failed` のどれか。`ready` のときだけ `url`（ホストからの相対パス）、`width`、`height`、`mime`、`codecs` が入ります。`preparing` の間は `progress`（0〜1）が入り、終わると `prepared` イベントが届きます。イベントを受け取れない場合は同じ要求を送り直して状態を確かめます。

`still` は常にテレビの動画プレーンと同じ大きさ（capabilities の `videoWidth`×`videoHeight`、ふつうは 3840×2160）で、写真を縦横比を保って収め、余白を黒で埋めます。テレビ側の拡大縮小に頼らないためです。形式は capabilities の `video` から `hevc-main10`、`hevc-main`、`av1-main10`、`vp9-profile2`、`vp9`、`h264-high` の順に選び、どれもなければ `unsupported` です。

メディアキーは `expiresAt` まで有効です。新しいセッションを開いても古いキーは期限まで使えるので、再生中の動画は途切れません。接続をオフにしたときと、テレビの許可を取り消したときは、その場ですべてのキーが無効になります。

**イベント**（JSON テキスト）:

| 向き | `type` | 内容 |
| --- | --- | --- |
| スマホ → テレビ | `library_changed` | 一覧が変わった |
| スマホ → テレビ | `prepared` | `itemId`、`target`、`state` の準備が終わった |
| スマホ → テレビ | `show` | スマホで選んだ `itemId` を表示する |
| スマホ → テレビ | `heartbeat` | 15 秒ごと。40 秒届かなければテレビは接続し直す |
| スマホ → テレビ | `session_closed` | スマホが接続をオフにした |
| テレビ → スマホ | `viewing` | テレビが表示中の `itemId`（一覧に戻ったら `null`） |

## エラーと CORS

エラーは `{ message }`（[error.json](fixtures/v2/error.json)）で、テレビにそのまま表示できる日本語です。キーが無効なら 401、項目がなければ 404 を返します。
テレビアプリは `file://` から読み込まれるため、ホストは全応答に `Access-Control-Allow-Origin: *` を付け、`OPTIONS` には `Access-Control-Allow-Headers: Authorization, Content-Type, Range` と `Access-Control-Allow-Private-Network: true` を返します。
画像と動画の応答には `Cache-Control: no-store` を付け、テレビのディスクに写真が残らないようにします。
