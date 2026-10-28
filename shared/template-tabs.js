// Generated from cure-erp-google-sheet-template.xlsx (_Index + row-1 headers). Do not edit by hand.
export default [
 {
  "tab": "Opening Stock",
  "module": "M09",
  "moduleName": "Inventory & Warehouse",
  "type": "Opening",
  "headers": [
   "Warehouse",
   "Item Code",
   "Item Name",
   "Item Category Type Name",
   "Batch Number",
   "Quantity",
   "Expiry Date",
   "Brand Name",
   "Stock Value"
  ]
 },
 {
  "tab": "Stock Ledger",
  "module": "M09",
  "moduleName": "Inventory & Warehouse",
  "type": "Stock",
  "headers": [
   "Date",
   "Type",
   "Doc",
   "Warehouse",
   "Item Code",
   "Item Name",
   "Batch Number",
   "Expiry Date",
   "Quantity",
   "Rate",
   "User"
  ]
 },
 {
  "tab": "Users",
  "module": "M01",
  "moduleName": "Login & User Management",
  "type": "List",
  "headers": [
   "Groups",
   "User Name",
   "Phone",
   "Email",
   "Password",
   "Branch",
   "Status",
   "Last Login",
   "Warehouse"
  ]
 },
 {
  "tab": "Activity Log",
  "module": "M01",
  "moduleName": "Login & User Management",
  "type": "List",
  "headers": [
   "User ID",
   "Event_Type",
   "Module",
   "Document_No",
   "Action",
   "Previous Value",
   "New Value",
   "Created_Date",
   "Created_Time",
   "Remarks"
  ]
 },
 {
  "tab": "Login Sessions",
  "module": "M01",
  "moduleName": "Login & User Management",
  "type": "List",
  "headers": [
   "User ID",
   "Created_Date",
   "Login_Time",
   "Logout_Time",
   "Branch",
   "Status"
  ]
 },
 {
  "tab": "Purchase Indent",
  "module": "M04",
  "moduleName": "Purchase Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Indent Type",
   "Requesting Warehouse",
   "Companies",
   "Status",
   "Narration-Notes",
   "Submit For Approval",
   "Lines"
  ]
 },
 {
  "tab": "Purchase Indent Pending",
  "module": "M04",
  "moduleName": "Purchase Management",
  "type": "List",
  "headers": [
   "Date",
   "Voucher_Name",
   "Voucher_Number",
   "Created_By",
   "Modified_By",
   "Created_Date",
   "Modified_Date",
   "Created_Time",
   "Modified_Time",
   "Suspended",
   "Authorization_Status",
   "Balance",
   "Linked_Value",
   "Link_Status"
  ]
 },
 {
  "tab": "Purchase Order — Domestic",
  "module": "M04",
  "moduleName": "Purchase Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Type Of Purchase",
   "Vendor Account",
   "Location",
   "Supplier Ref No",
   "Destination",
   "Is IGST",
   "Date",
   "Voucher Prefix",
   "Payment Terms",
   "Narration-Notes",
   "Terms of Delivery",
   "Place of Supply",
   "Submit For Approval",
   "Lines"
  ]
 },
 {
  "tab": "Purchase Order — Import",
  "module": "M04",
  "moduleName": "Purchase Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Type Of Purchase",
   "Vendor Account",
   "Exchange Rate",
   "Terms Of Delivery",
   "Narration-Notes",
   "Date",
   "Voucher Prefix",
   "Currency",
   "Location",
   "Supplier Ref No",
   "Destination",
   "Lines"
  ]
 },
 {
  "tab": "GRN  MRN",
  "module": "M05",
  "moduleName": "GRN / MRN Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Type Of Purchase",
   "Update Stock",
   "Location",
   "Narration-Notes",
   "Terms of Delivery",
   "Place of Supply",
   "Invoice No.",
   "Invoice Value",
   "Submit For Approval",
   "Date",
   "Vendor Account",
   "Raise Receipt",
   "Supplier Ref No",
   "Destination",
   "Is IGST",
   "Invoice Date",
   "Warehouse",
   "Attachment",
   "Lines"
  ]
 },
 {
  "tab": "Imprest Out — New",
  "module": "M06",
  "moduleName": "Imprest Management",
  "type": "Document",
  "headers": [
   "DocNo",
   "Date",
   "Customer Account",
   "Surgery",
   "Doctor",
   "Sales Executive",
   "Location",
   "Companies",
   "Narration / Notes",
   "Business Head",
   "OT Name",
   "Place of Supply",
   "Is IGST",
   "Ref. Doc",
   "Ref. Date",
   "Ship to Name",
   "Ship to Address",
   "Ship to City",
   "Ship to State",
   "Ship to Pin code",
   "To Warehouse",
   "Dispatch Name",
   "Dispatch City",
   "Dispatch Address",
   "Dispatch Pincode",
   "Dispatch State",
   "Supplier",
   "Bill Code",
   "Delivery Date",
   "Lines",
   "Return Closed"
  ]
 },
 {
  "tab": "Imprest Out Register",
  "module": "M06",
  "moduleName": "Imprest Management",
  "type": "List",
  "headers": [
   "DocNo",
   "Date",
   "Customer Account",
   "Surgery",
   "Sales Executive",
   "To Warehouse",
   "Authorization_Status"
  ]
 },
 {
  "tab": "Imprest Out Pending",
  "module": "M06",
  "moduleName": "Imprest Management",
  "type": "List",
  "headers": [
   "DocNo",
   "Date",
   "Customer Account",
   "Surgery",
   "Sales Executive",
   "To Warehouse",
   "Authorization_Status"
  ]
 },
 {
  "tab": "Imprest In — New",
  "module": "M06",
  "moduleName": "Imprest Management",
  "type": "Document",
  "headers": [
   "DocNo",
   "Date",
   "Customer Account",
   "Surgery",
   "Doctor",
   "Sales Executive",
   "Location",
   "Companies",
   "Narration / Notes",
   "Business Head",
   "OT Name",
   "Place of Supply",
   "Is IGST",
   "Ref. Doc",
   "Ref. Date",
   "Ship to Name",
   "Ship to Address",
   "Ship to City",
   "Ship to State",
   "Ship to Pin code",
   "To Warehouse",
   "Dispatch Name",
   "Dispatch City",
   "Dispatch Address",
   "Dispatch Pincode",
   "Dispatch State",
   "Imprest Ref",
   "Lines"
  ]
 },
 {
  "tab": "Imprest In Register",
  "module": "M06",
  "moduleName": "Imprest Management",
  "type": "List",
  "headers": [
   "DocNo",
   "Date",
   "Customer Account",
   "Surgery",
   "Sales Executive",
   "To Warehouse",
   "Authorization_Status"
  ]
 },
 {
  "tab": "Imprest In Pending",
  "module": "M06",
  "moduleName": "Imprest Management",
  "type": "List",
  "headers": [
   "DocNo",
   "Date",
   "Customer Account",
   "Surgery",
   "Sales Executive",
   "To Warehouse",
   "Authorization_Status"
  ]
 },
 {
  "tab": "E-Way Bill Outward",
  "module": "M07",
  "moduleName": "E-Way Bill Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Ref. Doc",
   "Supply Type",
   "Document Type",
   "Transporter Name",
   "Transporter ID",
   "Transport Mode",
   "Vehicle No.",
   "Distance (KM)",
   "Ship to State",
   "Dispatch State",
   "E-Way Bill No.",
   "Valid Upto",
   "Lines"
  ]
 },
 {
  "tab": "E-Way Bill Inward",
  "module": "M07",
  "moduleName": "E-Way Bill Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Ref. Doc",
   "Supply Type",
   "Document Type",
   "Transporter Name",
   "Transporter ID",
   "Transport Mode",
   "Vehicle No.",
   "Distance (KM)",
   "Ship to State",
   "Dispatch State",
   "E-Way Bill No.",
   "Valid Upto",
   "Lines"
  ]
 },
 {
  "tab": "Material Requisition",
  "module": "M08",
  "moduleName": "Material Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Companies",
   "Date",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "Material Issue",
  "module": "M08",
  "moduleName": "Material Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "Dealer Indent",
  "module": "M08",
  "moduleName": "Material Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Indent Type",
   "Dealer / Requester",
   "Mother Warehouse",
   "Status",
   "Linked Dispatch No.",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "Indent Register",
  "module": "M08",
  "moduleName": "Material Management",
  "type": "List",
  "headers": [
   "Document No.",
   "Indent Type",
   "Dealer / Requester",
   "Date",
   "Status"
  ]
 },
 {
  "tab": "Stock Transfer",
  "module": "M09",
  "moduleName": "Inventory & Warehouse",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "From Warehouse",
   "To Warehouse",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "Branch Receipt",
  "module": "M09",
  "moduleName": "Inventory & Warehouse",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Receiving Branch",
   "Ref. Doc",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "Actual Stock",
  "module": "M09",
  "moduleName": "Inventory & Warehouse",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Warehouse",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "RFID Generation",
  "module": "M10",
  "moduleName": "RFID Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "Item",
   "Batch",
   "Warehouse",
   "RFID Prefix",
   "No. of Tags",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "RFID Mapping",
  "module": "M10",
  "moduleName": "RFID Management",
  "type": "Document",
  "headers": [
   "Document No.",
   "Date",
   "RFID Tag",
   "Item",
   "Batch",
   "Warehouse",
   "Lines"
  ]
 },
 {
  "tab": "RFID Scanning",
  "module": "M10",
  "moduleName": "RFID Management",
  "type": "Document",
  "headers": [
   "Scan RFID",
   "Warehouse",
   "Purpose",
   "Lines"
  ]
 },
 {
  "tab": "RFID Printing",
  "module": "M10",
  "moduleName": "RFID Management",
  "type": "Document",
  "headers": [
   "Item",
   "Batch",
   "Label Format",
   "Printer",
   "No. of Copies",
   "Lines"
  ]
 },
 {
  "tab": "RFID Replacement",
  "module": "M10",
  "moduleName": "RFID Management",
  "type": "Document",
  "headers": [
   "Old RFID Tag",
   "New RFID Tag",
   "Reason",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "RFID Deactivation",
  "module": "M10",
  "moduleName": "RFID Management",
  "type": "Document",
  "headers": [
   "RFID Tag",
   "Reason",
   "Narration-Notes",
   "Lines"
  ]
 },
 {
  "tab": "Material Consumption",
  "module": "M11",
  "moduleName": "Material Consumption",
  "type": "Document",
  "headers": [
   "Document No",
   "Customer Account",
   "Location",
   "Warehouse",
   "Doctor",
   "Sales Executive",
   "Narration / Notes",
   "Business Head",
   "Submit for Approval",
   "Bill No",
   "Bill Date",
   "Imprest Ref",
   "Bill Status",
   "Lines"
  ]
 },
 {
  "tab": "Master Mapping",
  "module": "M13",
  "moduleName": "Tally Integration",
  "type": "List",
  "headers": [
   "ERP Master",
   "Tally Ledger / Group",
   "Mapping_Status"
  ]
 },
 {
  "tab": "Voucher Posting",
  "module": "M13",
  "moduleName": "Tally Integration",
  "type": "List",
  "headers": [
   "Voucher_Number",
   "Voucher_Name",
   "Created_Date",
   "Voucher_Amount",
   "Tally_Status"
  ]
 },
 {
  "tab": "GST Mapping",
  "module": "M13",
  "moduleName": "Tally Integration",
  "type": "List",
  "headers": [
   "GST Ledger",
   "Tax Type",
   "Tally Ledger",
   "Rate"
  ]
 },
 {
  "tab": "Reconciliation",
  "module": "M13",
  "moduleName": "Tally Integration",
  "type": "List",
  "headers": [
   "Voucher_Number",
   "ERP Amount",
   "Tally Amount",
   "Reconcile_Status"
  ]
 },
 {
  "tab": "Configuration",
  "module": "M14",
  "moduleName": "Administration & Audit",
  "type": "Document",
  "headers": [
   "Company Name",
   "Financial Year",
   "Date Format",
   "Voucher Prefix",
   "No. of Decimals",
   "Location",
   "Session Timeout (min)",
   "PO Pending Authorization Default",
   "Price Override Approval Threshold (%)",
   "Stack Price Meaning (to be confirmed)",
   "Lines"
  ]
 },
 {
  "tab": "Audit Logs",
  "module": "M14",
  "moduleName": "Administration & Audit",
  "type": "List",
  "headers": [
   "User ID",
   "Event_Type",
   "Module",
   "Document_No",
   "Action",
   "Previous Value",
   "New Value",
   "Created_Date",
   "Created_Time",
   "Remarks"
  ]
 },
 {
  "tab": "Security",
  "module": "M14",
  "moduleName": "Administration & Audit",
  "type": "Document",
  "headers": [
   "Minimum Password Length",
   "Password Expiry (days)",
   "Enable 2FA",
   "Lock After Failed Attempts",
   "IP Whitelist",
   "Lines"
  ]
 },
 {
  "tab": "Backup",
  "module": "M14",
  "moduleName": "Administration & Audit",
  "type": "Document",
  "headers": [
   "Backup Location",
   "Schedule",
   "Retention (days)",
   "Last Backup",
   "Lines"
  ]
 },
 {
  "tab": "Account Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Warehouse Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Warehouse Name",
   "Warehouse Type",
   "Location"
  ]
 },
 {
  "tab": "Warehouse Location Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Country Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Country",
   "State",
   "City"
  ]
 },
 {
  "tab": "State Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "City Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Branch Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Receiving Branch Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Branch Name",
   "Location",
   "Location Type"
  ]
 },
 {
  "tab": "Division Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Division Name",
   "Division Code"
  ]
 },
 {
  "tab": "Purchase Type Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Doctor Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Doctor Name",
   "Code",
   "Doctor Type"
  ]
 },
 {
  "tab": "Surgeon Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Surgery Name",
   "Code"
  ]
 },
 {
  "tab": "Sales Executive Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Salesperson Name",
   "Type"
  ]
 },
 {
  "tab": "Customer  Hospital Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Hospital Name",
   "Code",
   "Account Type",
   "Address",
   "City",
   "State",
   "Pincode"
  ]
 },
 {
  "tab": "Vendor Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Sup ID",
   "Vendor Name",
   "Supp Contact",
   "Portal Login ID",
   "Address",
   "City",
   "Pincode",
   "State",
   "GSTIN",
   "Drug Lic"
  ]
 },
 {
  "tab": "Item Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Item Name",
   "Code",
   "Brand",
   "Item Category",
   "Related Suppliers",
   "Min Stock Level",
   "MOQ",
   "Preferred Vendor",
   "Batch Number",
   "Expiry Date",
   "Warehouse"
  ]
 },
 {
  "tab": "Unit Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Units Name",
   "Code",
   "No. of Decimals"
  ]
 },
 {
  "tab": "Unit Conversion Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Brand Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Item Group Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Item Category Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Item Category Type Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Item Category Item Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Barcode Definition Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Sales Purchase Book Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Buyer Purchase Book Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 },
 {
  "tab": "Batch Stock Master",
  "module": "M03",
  "moduleName": "Master Data Management",
  "type": "Master",
  "headers": [
   "Master Id",
   "Name",
   "Code",
   "Status"
  ]
 }
];
