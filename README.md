# THE NOODLES

「stir fly eighteen」をオマージュしたラーメンカードゲームです。  
印刷用画像での対面プレイに加え、ブラウザでも 1〜4 人で遊べます。

**プレイ**: https://python-yarouze.github.io/the-noodles/

---

## デプロイ（GitHub Pages）

公開サイトは **GitHub Actions** からデプロイします（`docs/` を配信）。

1. リポジトリ Settings → Pages → Build and deployment → Source を **GitHub Actions** にする  
2. Actions Secret `METERED_API_KEY` に Metered（Open Relay）の Credential API Key を登録済みであること  
3. `main` への push、または Actions の「Deploy GitHub Pages」を手動実行  

オンライン対戦の NAT 越え用に Open Relay（`fulline.metered.live`）の TURN を使います。API Key はデプロイ時だけ `docs/js/ice-config.js` に埋め込まれ、リポジトリには含まれません。

### ローカル確認

```bash
cp docs/js/ice-config.example.js docs/js/ice-config.js
# ice-config.js の YOUR_API_KEY を自分のキーに置換
cd docs
python -m http.server 8080
```

`docs/js/ice-config.js` は gitignore されています。

---

## 遊び方（ロビー）

| モード | 手順 |
|--------|------|
| **オンライン（2〜4人）** | 「部屋を作る」→ 部屋コードを共有 → 相手が「部屋に参加」→ ホストが「はじめる」 |
| **1人（vs CPU）** | 「1人でプレイ（vs CPU）」 |
| **同じ PC（デバッグ）** | 画面下部の人数選択＋「同じPC（デバッグ）」 |

### 対戦設定（アコーディオン）

- **ルールセット**: THE NOODLES（★ありフル）／本家ルール（★なし）
- **目標ポイント**: デフォルト 50（先取）
- **味見の制限時間**: デフォルト 15 秒（`0` で制限なし）

ホスト／ソロ／同じ PC 開始時に反映されます。

### 進行のポイント

- ホストのブラウザが進行を管理します（タブを閉じると部屋は終了します）
- カードを選んでからアクション（伏せ札・料理・手札調整）
- 伏せ札への味見は**早いもの勝ち**（最初に味見した1人）。「パス」は個人単位で、全員がパスするか時間切れで続行
- **味見成功時**
  - 本家: 伏せ側はドロー不可。味見側は次ターン +1 ドロー
  - THE NOODLES: 伏せ側はドロー不可。味見側は宣言の予定ドロー枚数を山札から即時獲得（本家の +1 はなし）
- 「お助け」で手札から作れる料理・改善案・強い組み合わせを確認できます
- 「ルール」「効果を見る」でルール画像・カード効果を確認できます

---

## ゲーム概要

1. 手番で山札から 1 枚引く  
2. （任意）伏せて捨てて引く（1枚宣言／2枚ペア、各ターン各1回まで）— 相手は味見可能  
3. （任意）3〜5 枚で料理して得点（必須食材が必要。ごはんとめんは同時不可）  
4. 手札を 3 枚に整えて手番終了  
5. 目標点に達したら勝ち  

詳細はゲーム内の「ルールを見る」、またはリポジトリの `ルール.png` / `ラーメン効果表.png` を参照してください。

---

## オフライン得点ツール

印刷カード向けの組み合わせ計算です。

- `noodles.py` — CLI  
- `noodles_gui.py` — GUI（Pillow が必要）

```bash
pip install pillow
python noodles_gui.py
```

---

## ライセンス・クレジット

オマージュ作品です。本家「stir fly eighteen」のルール・世界観を参考にしています。  
カード画像・ルール画像は本リポジトリ付属のものを利用してください。
