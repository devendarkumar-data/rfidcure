# Cure ERP

React UI (single `index.html`, no build step) + Vercel serverless API (`api/sheet.js`) that stores data in Google Sheets.

## How stock works
1. **Opening stock** = your "Stock analysis by Batch" Excel (sheets MWH, DWH, CWH, as on 26/10/2026). Bundled in `index.html` / `data/opening_stock.json`; re-upload any time from **Inventory > Opening Stock Import**.
2. **Transactions** post on top of it: GRN (inward), Imprest Out, Imprest In, Stock Transfer, Material Issue, Material Consumption, Actual Stock (adjustment). Issues pick the earliest-expiry batch (FEFO) and block negative stock.
3. **Live Stock & Ledger** shows balances by warehouse / batch and every posting.

## Google Sheet tabs used
- `Opening Stock` (Warehouse, Item Code, Item Name, Item Category Type Name, Batch Number, Quantity, Expiry Date, Brand Name, Stock Value)
- `Stock Ledger` (Date, Type, Doc, Warehouse, Item Code, Item Name, Batch Number, Expiry Date, Quantity, Rate, User) - appended on every posting
- one tab per document / master (created automatically on first Save)
On page load the app reads `Opening Stock` and `Stock Ledger` from the Sheet (falls back to the bundled file if the Sheet is empty / not connected).

## Setup
1. **Google**: Cloud Console > new project > enable *Google Sheets API* > IAM > Service Accounts > create > Keys > Add key > JSON. Create a Google Sheet and **share it (Editor)** with the service account's `client_email`. Copy the Sheet ID from the URL.
2. **GitHub**: create a **private** repo (stock data inside) and push this folder.
3. **Vercel**: Add New Project > import the repo (Framework: Other, no build command). Environment Variables: `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (paste the JSON `private_key`, keep the `\n`). Deploy.
4. **Load opening stock into the Sheet** (either): open the app > Inventory > Opening Stock Import > *Sync opening stock to Google Sheet*; or locally `cp .env.example .env`, fill it, `npm i && npm run seed`.
5. **Test**: Imprest Out > Load sample > Save, then Live Stock & Ledger > Ledger; check the `Stock Ledger` tab in the Sheet.

## Local
`npm i -g vercel && npm i && vercel dev`

## Security
The API has no login yet. Turn on Vercel Deployment Protection (or add authentication) before real use.
