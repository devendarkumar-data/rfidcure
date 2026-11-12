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
To add a user by hand, fill a row and type a password in the **Password** column. The password stays visible in the sheet (it is **not** cleared). It is also mirrored as a bcrypt hash in **Credentials**. Changing the cell changes the login (the old password stops working); a password changed in the app or reset by an admin is written back to the cell when the cell holds a password. Branch `All Branch` means all warehouses (for Super Admin / Admin / Finance / Auditor).

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
Columns: `Groups | User Name | Phone | Email | Password` are required; `Branch | Status | Last Login | Warehouse` are optional and are added to the header if missing. Column order does not matter and extra columns are kept. A Warehouse value takes precedence over Branch.
- Sign-in ID is the **User Name** (case-insensitive, must be unique); the Email is also accepted if filled in.
- **Role** is read from `Groups`: comma-separated entries, the first valid role name wins (Admin, Super Admin, Sales or Sales Team, Finance, Auditor, Purchase Manager, Approver, Warehouse Manager, ...). `All` is a role (see Access Control below); entries such as Create, CRM, Production or Fabrication are not roles and are ignored; a row with no valid role cannot sign in.
- Blank Branch = All Branch; blank Status = Active. Roles limited to their own warehouse (Sales, Warehouse roles, Purchase Team, Data Entry) need a Branch such as MWH, DWH or CWH to see any stock.
- The plain-text Password in the Users tab is kept and is the source of truth for that user's login (anyone who can open the sheet can read it - restrict sheet sharing).

## Access Control (per group, per tab)
Administration -> **Access Control** shows every tab against every group. For each cell choose **None** (hidden), **View**, **Edit** (create and change) or **Default** (the standard role rules). Settings are stored in the `Access Control` worksheet (one row per tab, one column per group; blank = default; created automatically). Super Admin always has full access and its column is locked; only a Super Admin can change the Admin column. Every change is written to Audit Logs.
The **All** group sees and edits every operational and master tab on every warehouse, but not Users, Access Control, Security, Backup, Configuration or Audit Logs unless the matrix grants them.
Users with all-warehouse access get a **View warehouse** switcher in the top bar: choose one warehouse to see (and work in) only that warehouse, or All warehouses.

## Imprest Out — New form
- Hidden from the form: Ref. Doc and the whole Dispatch block (the sheet columns are kept).
- New header fields: **Supplier** (Vendor Master), **Bill Code**; **Companies** (Configuration company name + Account Master) and **Business Head** (Sales Executive Master rows whose Type is "Business Head", otherwise all salespersons) are dropdowns.
- Choosing the **Customer Account** fills Ship to Name / Address / City / State / Pin code and Bill Code from **Customer  Hospital Master** (new optional columns Address, City, State, Pincode).
- Lines: Warehouse defaults to the user's own (or the viewed) warehouse and only that warehouse is offered; choosing an item auto-selects the earliest-expiry batch and fills Batch, Expiry Date and Rate from stock; Delivery Date column added.
- Passwords typed in the Users tab are kept in the sheet (never cleared).

## Imprest Out / Imprest In / Consumption - how they relate
- **Imprest Out** moves stock from your warehouse to a hospital (imprest) warehouse. Example: 100 sent out. Delivery Date is in the main form; lines show Warehouse, Item (stock record), Quantity, Batch, Expiry (rate is kept in the background).
- **Imprest In** returns stock from the hospital: pick the hospital (only hospitals holding imprest stock sent from your warehouse are offered), then pick from the stock that hospital holds. Example: 80 returned; you cannot return more than the hospital holds.
- **Consumption** is what the hospital used out of the remainder (100 - 80 = 20): pick the hospital, pick from its stock, choose "Against Bill" and give the Bill No / Bill Date. You cannot consume more than the hospital holds.
- The balance at the hospital is always Out - In - Consumed, read from the stock ledger.

## Imprest In / Consumption flow
- **Imprest In — Pending**: open Imprest Outs from your warehouse (days open turns red after 30). Pick the Imprest Out document and enter the quantity **taken back** - in parts over several days or one lump sum. Nothing is consumed automatically.
- **Consumption Pending**: the same open Imprest Outs; enter what the hospital actually consumed (any time, in parts), with Bill No/Date or later via Update bill. Every In / Consumption carries the `Imprest Ref` of its Out (trail: Out -> In(s) / Consumption(s)). Balance = dispatched - returned - consumed. Status: Open -> Closed when the balance is 0 (no partial status).
- **Imprest In Register**: items taken back. **Imprest Out Register**: items dispatched with their settlement status.
- **Consumption Pending**: consumption whose bill is not updated yet (`Bill Status` = Pending Bill). **Update bill** (Bill No required, Bill Date) moves it to the **Consumption Register** (`Bill Status` = Billed).

## E-Way Bill
- New role **E-Way Bill Operator** (set Role = `E-Way Bill Operator` in the Users sheet; warehouse access = assigned Branch). Can create / edit E-Way Bills (outward and inward) and view dispatches; no access to GRN, purchasing, masters or admin. Super Admin, Admin and All also have the E-Way Bill stage.
- **Pending E-Way Bills** lists Imprest Outs and Stock Transfers (in the user's warehouses) with no E-Way Bill. **Create E-Way Bill** opens the form with Ref. Doc filled in; once saved (Ref. Doc = the dispatch number) the dispatch leaves the list.
- The E-Way Bill No. is typed from the GST portal. Automatic generation through the GST/NIC API needs GSP credentials and is not built.

## Vendor-wise PO numbers
- Number = `PREFIX/FY/SEQ`, e.g. `MIS/26-27/1001`. Prefix = the vendor's **Custom PO Prefix** (required in Vendor Master; old vendors with none use the shared `PO` series). One running counter per vendor and financial year for Domestic and Import together; the first number is 1001 and a new financial year starts again at 1001.
- Masters (Masters menu): **Vendor Master** (new columns Vendor Category, Custom PO Prefix, Allowed Purchase Type, Default Currency, Allowed Currency, Status; Vendor ID = `Sup ID`), **PO Series Config** (Series ID, Vendor ID, PO Prefix, Purchase Type, Financial Year, Last Sequence, Suffix, Status) and **Currency Master** (seeded on first use). All can be imported from Excel with the standard import button.
- The counter is kept in PO Series Config (updated under a lock, so two users cannot get the same number). A missing series row is created automatically on first use; an **Inactive** series row blocks creation with an error. Existing PO numbers never change; cancelled numbers are not reused. Inactive vendors and vendors not allowed for the chosen purchase type are refused. Import PO currency must be one of the vendor's Allowed Currency.
- Domestic POs stay in INR for now (foreign-currency domestic POs are not built).

## Stock Master
Inventory > **Stock Master**: opening quantity and live quantity per warehouse / item / batch (with expiry, rate, value). Hospital (imprest) locations are left out of Stock Master, Live Stock Overview and Batch-wise Stock. The old Opening Stock menu is replaced by it; import / edit of opening stock is the button on the Stock Master page.

## GRN / MRN – manual entry, attachments
- Create GRN offers three ways: against a PO, **Manual GRN** and **Manual MRN** (saved in the new trailing `Receipt Type` column of `GRN  MRN`). Manual forms default the warehouse to MWH when the user may use it.
- Place of Supply, Submit For Approval and Destination are no longer on the GRN form (the sheet columns stay).
- Supporting documents (PDF / PNG / JPG, 1.5 MB each, 5 per GRN) are stored in the new `Attachment Store` tab as base64 chunks. Sheet cells are small, so for larger files move this to object storage.
- The GRN register search covers invoice no., PO no. and the PO linked on each line.

## Import PO currency
- No exchange rate: an Import PO is created and printed wholly in the chosen currency (rates, gross, line totals, subtotal, grand total) with the currency sign. The PO list shows its value in that currency too.
- The currency must be one of the vendor's **Allowed Currency** values in Vendor Master; a vendor with no currency defined cannot be used for an Import PO.
- Vendor Category is a Domestic / International dropdown. Custom PO Prefix is optional (no prefix = the shared `PO` series).

## PO: stock panel and purchase-type links
- Selecting an item on a PO shows its available quantity in every warehouse (Opening Stock + GRN/MRN − Imprest Out + Imprest In − Consumption; hospital / imprest locations are not counted). The Closing Stock column shows the header warehouse (default MWH) and follows it when it changes.
- Vendor Master's `Allowed Purchase Type` column is shown as **Purchase Type Linked With Vendor** (a multi-select of purchase types; the sheet header is unchanged). On a PO, choosing Type Of Purchase limits the Vendor list to linked vendors, and choosing a vendor limits the Type Of Purchase list; a vendor with none linked is open to all. The words Domestic / Import / Both in that column still restrict the PO kind.

## Roles: stock visibility and Mother Warehouse Manager
- GRN Operator, Mother Warehouse Operator, Mother Warehouse Manager, Purchase, Entry Operator and Data Entry Operator can **view** stock and reports of every warehouse; they can post only in their own warehouse.
- Purchase Team creates POs and reads all masters and the stock ledger. Entry / Data Entry Operators raise indents and requisitions, do Imprest Out/In, Consumption and E-Way Bill.
- **Mother Warehouse Manager** (new role): indent, PO, transfer, imprest, consumption, requisition and read-only everywhere else.
- Left menu GRN / MRN: Manual GRN, Manual MRN, GRN Register, GRN-only and MRN-only registers.
- Imprest forms default Companies to "Cure Surgicals" and Place of Supply to Delhi.

### Role update (approver, GRN split)
- **Approver**: decides indent / PO / requisition queues; view-only on GRN, transfer, imprest, consumption, dispatch, E-Way and all reports; creates nothing and has no RFID / label access.
- **GRN Operator (MWH)**: creates GRN / MRN, views pending and authorized POs and all reports.
- **GRN Special Operator (MWH, new)**: GRN / MRN view + create + edit permission and all warehouse operations (transfer, imprest, consumption, requisition). Posted stock documents stay locked by the stock rule.
- **Entry Operator (MWH)**: everything except creating GRN / MRN - indent, stock transfer, requisition, imprest out/in, consumption, E-Way; GRN is view-only.
- **Mother Warehouse Operator (MWH all access)**: GRN / MRN, indent, stock transfer, requisition issue, imprest, consumption, E-Way and all reports; no PO / purchase. Menu GRN / MRN: Create GRN, Manual GRN / MRN (one screen, pick GRN or MRN), GRN Register, MRN Register.

### Imprest Out lines / Consumption Type / Manual entries
- Imprest Out line columns: Warehouse, Item, Description, Units, HSN, Stock in hand, Quantity, L-Surgery Set, Batch, Expiry Date, Rate, Gross, CGST, SGST, CESS, Taxable Value (= Quantity x Rate). Stock in hand is shown from the stock record picked.
- Consumption Type (Imprest In and Material Consumption): Consumption as Against PO, Broken, OTC.
- Left menu: Imprest In — Manual and Consumption — Manual open the entry form directly (no pending list).

### Approval switches, Imprest / Consumption vouchers (Nov 2026)
- **Administration > Configuration**: "Require Indent Approval" and "Require PO Authorization". Blank / ticked = approval required (default). Un-ticking sends a submitted indent (approved as requested) or PO straight to Approved. Two trailing columns were added to the Configuration sheet tab (after "Lines"): `Require Indent Approval`, `Require PO Authorization`. Enter `No` to switch off.
- **Imprest In — Manual / Consumption — Manual** (menu): pick the Imprest Out voucher (searchable); its items / batches load with the open quantity; enter quantities by hand. The server checks the voucher belongs to that hospital and that quantity does not exceed what is open. Consumption at a hospital must cite a voucher. Nothing is consumed automatically - stock the hospital still holds stays there until returned or consumed.
- Purchase Team can additionally view transfer, imprest, consumption, dispatch and E-Way pages (read-only) besides all stock and reports.

### Nov 2026 UI round
- GRN against a PO no longer has a Short-close column (PO "Close / short-close" stays on the PO screen).
- GRN / MRN Detail Register (menu GRN / MRN): one row per item line with search, type, warehouse, vendor and date filters.
- Administration > Approval (Indent / PO): switches for indent approval and PO authorization.
- GRN header laid out in fixed rows of four; Imprest registers use compact rows; line editors show Total Qty.
- Imprest In (settle) page: Open quantity, quantity taken back, and a "Convert into consumption" column + button for the part the hospital used.
- **Imprest Out stock selection**: pick the item, leave Batch blank for Auto (the server issues the oldest / earliest-expiry non-expired stock first, splitting across batches) or type / pick a batch by hand. Stock in hand shows for the item (or the chosen batch).

### Focus-style Imprest Out (Nov 2026)
- **Batch window** (Imprest Out line > "Pick batch (FIFO / LIFO)…"): shows the item's batches (batch, base quantity, expiry, qty adjusted, rate, stock in hand, warehouse) with Expiring in / after N days, search and "show all incl. expired". **Pick on FIFO** fills Qty Adjusted from the earliest-expiry batch onward until the line quantity is met; **Pick on LIFO** starts from the latest expiry. Ok writes one line per batch. Leaving Batch blank still auto-allocates earliest-expiry first when saved.
- Imprest Out form footer: Quantity, Stock in hand, Gross, CGST, SGST, IGST, Cess, Taxable Value, Net.
- Imprest registers: Date option list (Date Range, As on date, Current month … Previous Quarter), start / end date, hospital / warehouse, Output (Screen, Printer, Excel (CSV)); rows ordered newest date first, then highest document number.
- **Imprest Out auto batch**: after item + quantity are entered and the field is left, batches are filled automatically, earliest expiry first; if one batch is not enough the line is split and the rest comes from the next batch (expired batches are skipped; short stock is reported on save).
- **Totals block** (Quantity, stock in hand, Gross, CGST, SGST, IGST, Cess, Taxable Value, Net) shows under the lines of GRN / MRN, Imprest Out, Imprest In and Consumption.
- **Print layout** (GRN / MRN, Imprest Out / In, Consumption): Consumption Type, Item Code, Item Name, Qty, Rate, Batch No, Expiry Date. GRN / MRN has a Print button on its detail page.

### Nov 2026 round 3
- Delivery Date removed from Imprest Out and its register; Imprest Out register has a Status filter (Pending / Closed), newest first.
- Wording: "Manual" removed - menu has Create GRN, Special GRN (GRN or MRN, lines linked to POs), GRN Register, MRN Register; Imprest In — New, Consumption — New. LIFO removed from the batch window (FIFO only).
- Line grids (Imprest, GRN, PO, Indent...): small + / duplicate / remove icons on the LEFT of each line.
- Collapsible "Account / GST details" (Imprest forms) and "Totals" (GRN / MRN, Imprest, Consumption, GRN against PO).
- Purchase Indents: one register with the Status filter (Pending Review / Approved / ...), no separate menu entries.
- PO series: the same vendor name may exist as Domestic and as International in Vendor Master, each row with its own Custom PO Prefix; the PO number series is separate for each (Domestic PO uses the Domestic row, Import PO the International row).
- Special GRN: the PO No dropdown on a line lists only open POs of the chosen vendor that still have that item; the server re-checks the PO / item / balance / vendor on save.
- Actual stock stays: Opening + GRN / MRN (incl. Special GRN) + Imprest In - Imprest Out - Consumption.

## Imprest / Consumption registers (Focus column set) and per-document PDF
- Imprest Out, Imprest In and Consumption registers now use the Focus export columns: DocNo, Date, Customer A/c Name, Issues/Receipts, Doctor Name, Warehouse 1, Warehouse 2, Item Code, Item Name, Unit Name, Narration, Quantity, Item Brand, Batch, Net Amount, Authorize Status, Base Link Status, Expiry Date, Location Name, Manufacturing Date, Base Link Doc Date, Base Link Doc No, Link Status, Created User, Item HSN/SAC, Rate. The screen, CSV and `Excel (Sheet)` (.xlsx with a Grand Total row) all use them.
- `GET /api/imprest/register?type=out|in|cons[&export=xlsx]`. The Consumption Register menu now opens this register (Consumption Pending still handles bills).
- Every document row has a **PDF** button that downloads that transaction as its own PDF (jsPDF, built in the browser).
- Assumptions: Authorize Status is always "Authorized" (posted documents); Item Brand comes from Item Master; Manufacturing Date is blank unless the line carries one; xlsx has no Focus title rows.

## GRN / Requisition / Stock Transfer round
- "MRN" is gone from the app: Special GRN has no GRN/MRN toggle, **Receipt Type** and **Update Stock** are hidden (stock is always updated), the menu group is "GRN", prints say "Goods Receipt Note". The sheet columns stay (trailing) so no structure change.
- **Create GRN** now opens a PO register (all POs waiting for receipt) with search (PO no., vendor, item), date option / range and Pending / Approved filter; **Convert to GRN** opens the receipt for that PO. Special GRN defaults Warehouse MWH and Location Delhi.
- **GRN Register**: date option / range, type (GRN against PO / Special GRN), search; download CSV, Excel or PDF.
- Every list table that is exportable (GRN, Requisition, ...) now has a CSV / Excel / PDF download selector.
- **Stock Transfer**: From Warehouse defaults to MWH; the To list excludes MWH (`/api/lookup?field=Warehouse&exclude=MWH`). Raise Requisition: requesting-warehouse list excludes MWH (MWH is the issuer). Narration/Notes is narrower on both.
- Choosing an item fills **Units** automatically; the item column is wider. Totals and "Account / GST details" start collapsed.
- Assumption: GRN documents are posted immediately, so there is no Pending/Approved status on the GRN Register (the PO register has it).

## Item Master headers and where live stock is tracked
- Item Master columns: Master Id, Item Name, Code, Brand, Item Category, Related Suppliers, Min Stock Level, MOQ, Preferred Vendor, Batch Number, Expiry Date, Warehouse, then the new trailing **HSN** and **UOM**. HSN pre-fills the HSN on Imprest / E-Way lines; UOM fills Units when an item is picked. **Add the two header cells (HSN, UOM) to the Item Master sheet** (trailing, after Warehouse) before filling them.
- Live stock is not stored anywhere: it is **Opening Stock** (the old software's closing stock, entered once) **+ the Stock Ledger** (every posted GRN, transfer, Imprest Out/In, consumption, actual-stock variance). Inventory → Live Stock Overview / Batch-wise Stock / Stock Master and Reports → Stock Reports / Stock Ledger all compute from those two tabs.
- **HSN auto-pick**: Purchase Indent, PO, Imprest Out, Imprest In, Consumption and E-Way Bill lines have an HSN field. It fills from the Item Master HSN when the item is picked, and the server fills any line left blank on save, so accounts and the E-Way Bill always carry it. Items with no HSN in the Item Master stay blank until you add one there.

## Special GRN split, drafts, keyboard, dual settlement
- **GRN** (against a PO, all accounting terms) and **Special GRN** (no rates, taxes, discounts or invoice value; goods keyed by hand, optional PO link per line) are separate: menu **Create GRN / Special GRN / GRN Register / Special GRN Register**. Special GRNs are stored with Receipt Type = "Special GRN" (older ones with no PO number are treated the same); `GET /api/t/grn-mrn?grnType=po|special`.
- Registers open **newest first** (the client no longer forces ascending); dates on screen are **DD-MM-YY** (exports keep yyyy-mm-dd). The "— New" suffix is gone from titles; menu items read Create Imprest Out / Imprest In (direct) / Consumption (direct).
- **Auto-save**: new-document forms (Imprest Out/In, Consumption, Stock Transfer, Special GRN, masters…) save a draft in this browser 1.5 s after every change; reopening the form offers *Restore it / Discard*; **Unsaved drafts** in the menu lists them all with Resume / Discard. Drafts are cleared when the document is saved. They live in the browser only (not shared between computers). PO / Indent / Requisition / PO-based GRN forms do not auto-save yet.
- **Dropdowns**: ↑ ↓ move (list scrolls), Enter picks, Esc closes, Tab / Shift+Tab accept the highlighted match and move on.
- **Imprest In + Consumption together**: on the Imprest In screen for a voucher, enter per item/batch both *Taken back* and *Consumed*; one Save posts the Imprest In and the Consumption (`POST /api/imprest/settle`; back + consumed may not exceed the open balance).
- Imprest Out batch selection is first-expiry-first-out (unchanged).
