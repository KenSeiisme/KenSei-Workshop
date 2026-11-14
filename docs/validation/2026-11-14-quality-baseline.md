# 2026-11-14 品質改進驗收

## 本機檢查

以下命令可在乾淨 checkout 執行。CI 使用 Node.js 24、pnpm 12.18.0 和 Python 3.12；瀏覽器回歸另用本機預覽。

```powershell
pnpm install --frozen-lockfile
python -m pip install -r requirements-dev.txt
pnpm format:check
python build.py
pnpm test:i18n
pnpm test:structure
pnpm test:unit
pnpm test:database
```

- 雙語掃描涵蓋本站 JavaScript 的雙引號 `uiMsg` 字面量。頁面驗證也會核對有改動的文案是否出現在實際載入的語言包。此掃描的範圍是明確字面量，動態字串與模板文字另靠頁面測試。
- 本輪基準為 118 個本地化頁面、110 條公開 Sitemap 網址、106 張使用中的分享圖及 47 筆搜尋索引。另有一份 Vercel 使用的 `404.html`。
- 資料庫測試使用 PGlite 及本機 fixture。單元和資料庫測試可在 CI 執行，涵蓋範圍和實際 Google 登入或多人協作驗收不同。
- 執行 `python scripts/serve.py 8769`，再以設定 `TEST_BASE_URL=http://127.0.0.1:8769` 的終端執行 `pnpm test:browser`。代表性檢查為 `localization.cjs`、`fifth-tools.cjs`、`game-hub.cjs` 及 `sixth-media.cjs`，皆在 `tests/browser/`。

## 部署複查

- GitHub 的 `preview` 同時觸發 Actions 和 Vercel。兩者通過後，將已驗證的同一份來源推到 `KenSei-Workshop`。
- 複查首頁四項安全標頭、帶雜湊的字型一年快取、`fonts.css` 與 Whiteboard 入口的重新驗證、象棋的隔離標頭及 KenSei Studio 更新檔的 `no-store`。在 HTTPS 正式頁面檢查相機、錄音、錄屏頁面仍允許使用本站權限。實機權限提示與模擬串流分開記錄。
- 首頁熱門資料使用 Vercel Production 環境中的 `WORKSHOP_ANALYTICS_TOKEN`。若 `/api/home-popular/` 回傳 `updatedAt: null`，在 Vercel 後台確認環境變數、專案權限及函數記錄。調整環境變數後重新部署。同一區有至少四個實際瀏覽項目時會使用 `analytics`。成功讀取但樣本不足時仍以 `featured` 顯示，正常快取可維持約一天。
