# Cure Surgical ERP

React (Vite) front end + Vercel serverless API (`api/handler.js`) + Google Sheets as the data store.
Login with User ID and password, role-based access enforced on the server, warehouse-wise stock with batch/expiry (FEFO),
and the workflow **Purchase Intent → Purchase Order → PO Authorization → GRN → stock**.

```
src/            React app (pages, components, layouts)
api/            one Vercel serverless function; it only calls server/router.js
server/         API code: auth, permissions, Google Sheets access, stock engine, workflow
shared/         access matrix (permissions.js) and worksheet registry (registry.js) - the single source of truth
scripts/        maintenance scripts (init sheet, first admin, opening-stock import)
tests/          automated tests (npm test)
data/           cleaned opening stock proposal + dev seed
```

## 1. How it works (short)

* The browser never talks to Google. It calls `/api/...`; the server checks the session cookie, the role, the warehouse and the field permissions, then reads/writes the sheet.
* Only worksheets listed in `shared/registry.js` can be touched. Sheet names, ranges and the spreadsheet id are never taken from the browser.
* Passwords are stored as bcrypt hashes in the `Credentials` tab. Sessions are signed, HttpOnly cookies. Deactivating a user or changing a password ends their sessions.
* Stock = **Opening Stock + Stock Ledger**. Only posted documents move stock: GRN (in), Imprest Out/In, Stock Transfer, Material Issue, Consumption, Actual Stock (variance). **Intents and POs never change stock.**
* Quantities such as "ordered on intent" and "received on PO" are always recalculated from the documents, never stored, so they cannot drift.

## 2. Roles

| Role | Typical use |
|---|---|
| Super Admin / Admin | everything (Admin cannot manage Super Admin accounts; Billing is blank for Admin as in the matrix) |
| Purchase Manager | review/approve intents, create + authorise POs, close POs, view GRN and reports |
| Purchase Team | create/edit POs, view intents and GRN |
| Warehouse Manager | raise intents, GRN, transfers, imprest, consumption for assigned warehouses |
| Warehouse Operator | raise intents, create GRN, view stock for assigned warehouses |
| Finance Team, Sales Team, Auditor, Data Entry Operator | as in the access-matrix image |

Edit `shared/permissions.js` to change who can do what (one place). Warehouse scope comes from the user's **Branch** cell: a comma-separated list of warehouse codes, e.g. `MWH, DWH`. Roles with "all" scope ignore it.

## 3. One-time setup

### 3.1 Install tools
Node.js 24 (or 20+), Git, a Google account, a GitHub account, a Vercel account.

### 3.2 Google Cloud + Sheet
1. <https://console.cloud.google.com> → create a project → **APIs & Services → Library → Google Sheets API → Enable**.
2. **IAM & Admin → Service Accounts → Create** (no roles needed) → open it → **Keys → Add key → JSON**. Keep the file private.
3. Upload `cure-erp-google-sheet-template.xlsx` to Google Drive and open it as a Google Sheet (File → Save as Google Sheets). Copy the **sheet id** from the URL (`/d/<ID>/edit`).
4. **Share** the sheet with the service account's `client_email` as **Editor**.
5. Do not rename tabs or edit row 1 of any tab. The app refuses to run against a tab whose header differs from the template.

### 3.3 Local setup
```bash
npm install
cp .env.example .env        # fill SESSION_SECRET, GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
npm run init-sheet          # creates the 3 extra tabs (Credentials, Doc Status, Doc History); verifies the others
npm run check-sheet         # read-only report of every tab
npm run create-admin -- --user admin --name "Your Name"     # first Super Admin (asks for a password)
npm run dev                 # app on http://localhost:5173, API on :3001
```
No Google yet? `STORE=memory npm run dev` runs everything against an in-memory copy (dev only; blocked in production). Demo users are printed in the console.

### 3.4 Opening stock
In the app: **Inventory → Opening Stock** shows every opening row with filters (warehouse, item, batch, category, brand, expiry status/range, *stock as on date*), CSV export, and (Admin / Super Admin) **Import** of an .xlsx or .csv. The import first checks the file (errors, duplicates, negatives, bad dates, unknown warehouses) and writes nothing until you confirm. *Replace all* is refused once the Stock Ledger has postings; *Add rows* is always allowed but refuses combinations that already exist. Every import is written to Audit Logs.

Command-line alternative:
`data/cleaned/` contains a **proposal**: `Opening_Stock_CLEANED_for_approval.xlsx` and `Opening_Stock_cleaning_report.xlsx`. Review the report, then
```bash
npm run import-opening-stock -- data/cleaned/Opening_Stock_CLEANED_for_approval.xlsx            # dry run
npm run import-opening-stock -- data/cleaned/Opening_Stock_CLEANED_for_approval.xlsx --confirm  # writes
```
The script refuses to replace opening stock after ledger postings exist.

### 3.5 GitHub
```bash
git init && git add . && git commit -m "Cure ERP"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
`.env` is git-ignored. Never commit keys.

### 3.6 Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo. Framework preset **Vite** (detected from `vercel.json`).
2. **Settings → Environment Variables** (Production, and Preview if you want previews): `SESSION_SECRET`, `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (paste the key with its `\n` sequences). Optional: `DEFAULT_PO_LOCATION`.
3. **Deploy.** Open `https://<project>.vercel.app/api/health` → `{"ok":true,"store":"sheets"}`, then sign in.
4. Every later `git push` to `main` redeploys automatically.

## 4. Using the workflow

1. **Purchase Intent** (Warehouse Operator/Manager): pick warehouse and items, quantities, required-by date, priority, reason → Save draft or Submit. Current warehouse stock is shown per line.
2. **Review** (Purchase Manager): Approve (optionally with lower approved quantities), Reject or Return for correction (remarks required). History is kept.
3. **Create PO from intent**: choose approved intent lines; quantity cannot exceed the remaining approved quantity (an authorised user can override with a recorded reason). Domestic PO: Location defaults to the configured warehouse and Destination always equals Location.
4. **Pending PO Authorization → PO Authorization**: an authoriser other than the creator reviews, may reduce quantities or remove lines (originals are kept in history), then Approve / Reject / Return. Approved POs appear in **Approved POs** and **Pending POs** until fully received.
5. **GRN**: choose an approved PO; vendor, warehouse and balances come from the PO; enter received / rejected quantities, batch and expiry. Accepted quantity is posted to stock once; the PO moves to Partially Received, then Completed. A manager can short-close a PO with remarks.

## 5. Tests
`npm test` runs the automated tests (permissions, login/lockout, stock rules, FEFO, concurrency, idempotency, the full intent→PO→GRN flow, and the Sheets store against a fake Google API). See `TESTING.md` for the manual checklist and what is **not** covered.

## 6. Schema additions (need your approval)
The template is unchanged. The app adds three worksheets, created by `npm run init-sheet`:
* `Credentials` – User ID, Email, Password Hash, Must Change Password, Failed Attempts, Locked Until, Password Updated
* `Doc Status` – current status, created/submitted/reviewed by + time, remarks, source intent, totals per intent and PO
* `Doc History` – one row per workflow event (who, when, from → to, remarks, details)

## 7. Known limitations
* **Google Sheets quotas.** About 60 reads per minute per service account; the app caches Users/Config for 20 s and masters for 30 s. Fine for a small team; plan a database if many people work at once or data grows into the tens of thousands of rows per tab.
* **Concurrency.** Writes are serialised per server instance and stock is re-verified after every posting (a posting that would make stock negative is rolled back with compensating ledger rows). Two different serverless instances posting the same batch at the same instant could still race; the post-check makes this very unlikely to leave bad data, but it is not a database transaction.
* A sheet edited by hand while the app is running can break links (e.g. deleting a row that a document refers to). Treat the workflow tabs as read-only for humans.
* No e-mail: password reset is "administrator issues a temporary password".
* 2FA setting is stored but not enforced. IP whitelist is enforced at login for everyone except Super Admin.
* Attachments (GRN) are a text reference only; no file storage is configured.
* Billing and Dispatch stages exist in the access matrix but the template has no billing/dispatch worksheet, so there is nothing to open there yet.

## Purchase Requisition, Reports, Dashboard (v3)

**Purchase Requisition** (internal replenishment, warehouse → Mother Warehouse; not a vendor purchase)
- Flow: Draft → Pending Approval → Approved → (Partially) Dispatched → (Partially) Received. Rejected / Cancelled possible.
- Approver ≠ creator (Super Admin exempt). Dispatch/receive are scoped to the issuing / requesting warehouse.
- Stock moves through an in-transit location `TRANSIT-<requesting warehouse>`: dispatch Mother → TRANSIT, receive TRANSIT → destination, same batches. All quantities are derived from the stock ledger.
- If the Mother Warehouse is short, the form shows a shortage warning and a **Raise Purchase Indent** link (pre-filled).
- New worksheet: **Purchase Requisition** (created by `npm run init-sheet`; additional new tabs overall: Credentials, Doc Status, Doc History, Purchase Requisition). Needs your approval before use on the live sheet.

**Hospital / virtual stock** – create hospital locations in *Warehouse Master* with a Warehouse Type containing "virtual", "hospital" or "imprest". Hospital delivery = Imprest Out; consumption at that location deducts it once. Virtual stock is excluded from warehouse totals.

**Roles added** – Mother Warehouse Operator, Approver (plus Purchase Manager / Warehouse Operator labels).

**Reports** – 18 live reports under *Reports* (search, filters, sort, pagination, Excel/CSV export, audited). Per-warehouse reports are presets of Warehouse-wise Live Stock. Low-stock uses Item Master "Min Stock Level".

**Dashboard** – total items, opening stock, current stock, per-warehouse stock (dynamic: MWH/DWH/CWH), virtual stock, in transit, consumption, low-stock, pending indents/requisitions/PO authorization, approved POs, GRNs, recent transactions, inward/outward by warehouse.

**Open items** – PO print template not supplied (placeholder layout); Item Master has no UOM and Opening Stock has no Unit/Date/Remarks columns (not added without approval); no "Item Price History" tab exists in the sheet.

## Multi-user (live) use
- Each person signs in with their own User ID/password; Super Admin/Admin create users in **Administration → Users** (role + assigned warehouses, one-time temporary password, forced change at first sign-in, deactivate, reset).
- Warehouse scope is enforced on the server for every read and write; simultaneous postings to the same batch are serialized (no negative stock, no duplicates).
- Lists, dashboard, reports and stock pages refresh automatically every 20 s while the tab is visible (`src/useTick.js`).
- Google Sheets is fine for ~10–30 concurrent users; for more, swap the store for Postgres (`server/store`).

## Users tab layout and sheet passwords
The **Users** tab columns are: `User ID, User Name, Password, Role, Branch, Status, Last Login`.
To add a user by hand, fill a row and type a password in the **Password** column. At that user's first sign-in the password is verified, stored as a bcrypt hash in **Credentials**, and the cell in the Users tab is **cleared**. Typing a new password in the cell later acts as a password reset (same one-time pickup). Branch `All Branch` means all warehouses (for Super Admin / Admin / Finance / Auditor).

## Purchase Order print and master data
- **Print PO** (PO page → Print) follows the supplied Cure Surgical format (invoice-to block, supplier details, item table with CGST/SGST/IGST, totals, amount in words, terms, signatory). Print / Save as PDF from the browser.
- Company details come from `shared/company.js` (name can be overridden by Configuration > Company Name).
- **Vendor Master** gained optional columns `Address, City, Pincode, State, GSTIN, Drug Lic` (used on the PO). **Item Master** gained `UOM` (shown as Units on indents/POs; defaults to NOS). Existing sheets are upgraded automatically: the app appends the new header cells on first use and leaves all data untouched. Vendor Code on the PO is the vendor's `Sup ID`.
- Opening Stock filters (Warehouse, Category, Brand, Expiry status = Expired / Expiry soon (≤ 90 days) / Valid / No expiry) are multi-select and combine.
- Purchase Indent defaults the requesting warehouse to the signed-in person's warehouse, fills Units from the item, and shows live current stock at that warehouse.

## Import / Export
- **Master pages** (Item, Vendor, Warehouse, Hospital/Location, other masters): *Export Excel*, *Export CSV* and *Import* buttons. Import takes .xlsx/.csv (blank templates provided), checks every row with the same rules as the form, shows an error report, and writes nothing until the whole file is valid (option to skip rows that already exist). Master Ids are generated automatically; existing records are never changed.
- **Opening Stock**: *Export Excel*, *Export CSV*, *Import Opening Stock* (replace or add) and *Add opening stock*; the menu links Import/Export Opening Stock open the same actions.

## Purchase Order line fields
Domestic PO lines carry the full spec set (Items, Description, Warehouse, Units, Closing Stock, Reorder Level, Nos. of Pcs/Box, Quantity, Rate, SP Rate, Price Type, Price Book Rate, Special Rate, Last PO Rate, Brand, Item Group, Division, discount, GST %). They are stored as JSON in the PO's `Lines` cell, so the sheet needs no extra columns. Closing Stock, Reorder Level (Item Master Min Stock Level), Brand and Last PO Rate autofill when an item is picked.
Purchase Requisition register rows have inline Approve (full requested quantity) and Reject buttons for users allowed to approve.

## Users tab layout (current)
Columns: `Groups | User Name | Phone | Email | Password | Branch | Status | Last Login` (Branch, Status, Last Login are optional trailing columns; a sheet that has only the first five is extended automatically).
- Sign-in ID is the **Email**.
- **Role** is read from `Groups`: comma-separated entries, the first valid role name wins (Admin, Super Admin, Sales or Sales Team, Finance, Auditor, Purchase Manager, Approver, Warehouse Manager, ...). Entries such as All, Create, CRM, Production or Fabrication are not roles and are ignored; a row with no valid role cannot sign in.
- Blank Branch = All Branch; blank Status = Active. Roles limited to their own warehouse (Sales, Warehouse roles, Purchase Team, Data Entry) need a Branch such as MWH, DWH or CWH to see any stock.
- The plain-text Password is accepted once, hashed, and the cell is cleared.
