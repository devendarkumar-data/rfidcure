# Testing

## Automated (`npm test`)
Runs against an in-memory store and a fake Google Sheets API. Covers:

| Area | What is checked |
|---|---|
| A. Login | valid / invalid credentials, same error for unknown user and wrong password, lockout after repeated failures, deactivated users, cookie flags, password policy, password change and admin reset invalidate old sessions, forced password change |
| B–D. Intent & PO | create + submit, manager review, return with remarks and resubmit, partial approval, intent → PO with remaining-quantity check, idempotent double submit, tax split (CGST/SGST vs IGST), maker-checker, authoriser quantity edits with history, reject releases quantity |
| E. Pending POs | approved + unreceived PO listed; removed on full receipt, close or reject |
| F. GRN | receipt against approved PO only, balance check, partial then full receipt, vendor/warehouse taken from PO, double submit does not double post |
| G. Item master | item code/name resolved server-side from the central catalogue; unknown items rejected |
| H. Stock | intents and POs never change stock; GRN posts exactly once; FEFO, no negative stock, expired batches not auto-issued, concurrent postings |
| I. Permissions | per-role stage access, warehouse scope on lists/records/postings, field-level hiding, generic API cannot bypass the workflow, CSRF and cross-origin blocked, unregistered tabs unreachable |
| Opening stock | view filters, as-on-date quantity, scope, CSV export, import validation (negatives, duplicates, dates), append vs replace rules, xlsx import, audit |
| Sheets store | header check, create-missing-tab, update with change detection, delete, size limit (fake Google client) |

## Manual checklist (needs your Google Sheet and Vercel)
- [ ] J. Deploy: `/api/health` shows `"store":"sheets"`; sign in works on the production URL.
- [ ] `npm run check-sheet` reports all worksheets OK.
- [ ] Create a user for each role (Administration → Users); sign in as each; confirm menus match the role.
- [ ] Warehouse Operator (Branch `MWH`) cannot see DWH stock or intents.
- [ ] Intent → review → PO → authorise (different user) → GRN, comparing the Stock Ledger rows and the PO balance in the sheet.
- [ ] Print a PO and compare with your supplied PO format (**the format was not available to me - see open items**).
- [ ] Deactivate a user in the sheet; the user is signed out within ~20 seconds.
- [ ] Phone-width layout for login, dashboard, intent form, PO register.

## Not tested
* Anything against the real Google Sheets API or the real Vercel platform (no credentials in my environment).
* Behaviour with more than a few thousand rows per tab, or many simultaneous users.
* Printing against your official PO format.

| Purchase Requisition | `tests/requisition.test.js` – approval, maker-checker, partial dispatch/receive, in-transit, shortage |
| Reports & dashboard cards | `tests/reports.test.js` – report filters/export, dashboard cards, virtual stock, no double deduction |
