# Student Billing Analysis Dashboard

## Website Requirements and Claude Build Specification

**Working name:** JADI Student Billing Analysis Dashboard  
**Primary database:** Microsoft SQL Server, database `ousadb`  
**Source system:** Jenzabar/JADI operational and cloud data  
**Document purpose:** Define the business, functional, data, security, and acceptance requirements needed for Claude to design and implement the website.

## 1. Product Vision

Create a secure, responsive web application that surfaces current and historical student billing, enrollment, and financial-clearance data for analysts and authorized operators. The dashboard must convert operational data into timely metrics, drill-down reports, trend charts, student profiles, downloadable working files, and explainable AI-assisted observations.

The application is an analysis and workflow-support system. It must not change Jenzabar financial records unless a future, separately approved write-back requirement is added.

## 2. Primary Objectives

1. Present near-real-time enrollment, clearance, receivable, charge, credit, and clearance-sprint metrics.
2. Allow analysts to move from summary cards to the student records behind each number.
3. Retain scheduled snapshots so users can analyze trends and compare semesters.
4. Help operators identify students who did not clear (DNC) or did not return (DNR).
5. Provide student-level billing, payment, enrollment, and academic context.
6. Produce controlled exports and mail-merge files for authorized follow-up.
7. Apply role-based access controls and protect student educational and financial data.
8. Provide transparent, evidence-based AI summaries without allowing the AI to alter source data.

## 3. User Roles and Permissions

### 3.1 Administrator

- Full access to dashboards, reports, student profiles, exports, schedules, metadata, operator profiles, audit logs, and system configuration.
- Create, edit, deactivate, and assign roles to users.
- Configure refresh schedules, semester metadata, classification mappings, data-source connections, and AI settings.
- View job failures and manually trigger a refresh.

### 3.2 Operator

- View current-semester dashboards and authorized historical reports.
- Search for students and view student profiles.
- View clearance worksheets when available.
- Create permitted exports and mail-merge files.
- No access to connection secrets, global security configuration, or user-role administration.

### 3.3 Viewer

- Read-only access to authorized aggregate dashboards and reports.
- Student-level data and exports must be disabled by default and granted only through an explicit permission.

### 3.4 Permission Model

Use role-based access control plus granular permissions. Enforce authorization in the server/API layer, not only in the interface. Suggested permissions include `dashboard.view`, `history.view`, `student.view`, `worksheet.view`, `export.create`, `mailmerge.create`, `operator.manage`, `user.manage`, `metadata.manage`, `schedule.manage`, `ai.view`, and `audit.view`.

## 4. Information Architecture

The authenticated website shall contain:

1. Sign In
2. Current Semester Dashboard
3. Clearance Sprint
4. DNR/DNC Analysis
5. Historical Analysis
6. Student Lookup and Student Profile
7. Reports and Analyses
8. AI Analyses
9. Administration
   - Users and Roles
   - Operators
   - Semester/JADI Metadata
   - Data Connections
   - Refresh Schedules and Job Status
   - Classification Mappings
   - Audit Log

## 5. Global User-Experience Requirements

- Use a professional, accessible, data-dense dashboard design suitable for desktop analysts, while remaining usable on tablets.
- Provide a persistent left navigation panel, page title, current semester indicator, last successful refresh time, and signed-in user menu.
- Display currency in U.S. dollars, counts with thousands separators, and percentages to two decimal places unless a report requires otherwise.
- Every summary card must support a drill-down action where detail data exists.
- Every table must support sorting, pagination, column visibility, filtering, and accessible keyboard navigation.
- Provide global filters where applicable: semester, school year, classification, clearance status, operator, clearance date range, balance range, and search term.
- Show active filters clearly and provide a one-click reset.
- Provide loading, empty, stale-data, partial-data, and error states. Do not display a zero when a query failed.
- Show the data timestamp and source/snapshot identifier on every exported report.
- Charts must include legends, tooltips, accessible labels, and a companion data table or downloadable data.
- Use institution branding as a configurable theme rather than hard-coding colors or logos.

## 6. Current Semester Dashboard

### 6.1 Cleared vs. Enrolled Hero Card

This is the primary front-and-center display.

Display:

- Total enrolled students
- Total financially cleared students
- Total not cleared students
- Financially cleared percentage: `Cleared / Enrolled * 100`
- Last refresh timestamp
- Optional comparison with the prior snapshot, such as change since yesterday

Data rules supplied by the mind map:

- Enrolled: `COUNT(*)` from `view_ourm_fca`
- Cleared: `COUNT(*)` from `view_ourm_stats` where `[rows] = 1`
- Not cleared: `COUNT(*)` from `view_ourm_fca` where `[status] <> 'Cleared'`
- Guard against division by zero.

Visual requirement: show a prominent progress/donut or horizontal completion indicator and the exact values. Clicking Enrolled, Cleared, or Not Cleared opens a filtered student detail table.

### 6.2 Current Receivable Card

Display the sum of positive `tblStudent.AccountBalance` values for students whose `LastCleared` corresponds to the current `tblOUSA` Traditional or LEAP term. Return a numeric decimal from SQL and format currency in the application. Provide drill-down to students with positive balances.

### 6.3 Charges, Credits, and Delta Card

Display:

- Total charges from `view_ourm_charges`
- Expected financial aid/credits from `view_ourm_credits`
- Delta = charges minus credits

The interface must use clear labels rather than relying only on `RCV` and `FIN`. The delta must have a neutral, positive, or warning treatment based on an administrator-defined rule; color must not be the only indicator.

### 6.4 DNR/DNC Summary Card

Display counts and positive account-balance totals for:

- DNC - Did Not Clear: enrolled for the current semester but not financially cleared.
- DNR - Did Not Return: registered/cleared in the previous semester but not returned for the current semester.

Clicking either category opens the detail report described in Section 8. The final DNR rule must explicitly verify absence from current enrollment; the implementation must not infer DNR solely from a prior-term flag if that can include returning students.

## 7. Clearance Sprint

The Clearance Sprint is the beginning-of-semester period during which students are financially cleared for attendance. Administrators must be able to define its start and end dates per semester.

### 7.1 Cleared by Date

- Display daily clearance counts for the selected sprint or date range.
- Include a total-to-date row.
- Use a line or column chart plus a detail table.
- Allow selection of a date to open the students cleared that day.

### 7.2 Cleared by Operator

- Display clearance counts grouped by `ClearedBy`.
- Resolve source codes to friendly operator names using the Operator Profile table.
- Include an Unknown/Unmapped category and a total row.
- Allow drill-down to students processed by an operator.

### 7.3 Cleared by Classification

- Display enrolled, cleared, not cleared, and clearance percentage by student classification.
- Use the initial mappings: FR/FF = Freshmen, SP = Special, AE = LEAP, AD = Academy, XX/blank = Unclassified, JR = Junior, EM = Employee, DI = Dietetic, SO = Sophomore, SR = Senior, TR/Incoming Transfer = Transfer Student, and GR = Graduate.
- Store mappings and sort order in configurable metadata rather than hard-coding them in interface code.
- Include a grand total row.
- Treat Incoming Transfer as TR before combining FF and FR as Freshmen.

### 7.4 Sprint Analysis Modules

- Financial clearance analysis by classification
- Daily clearance count analysis
- Financial clearance by operator
- Optional comparison to the same point in prior semesters
- AI-assisted narrative summary, subject to Section 12

## 8. DNR/DNC Analysis

Provide summary cards and a detailed table with:

- Category: DNR or DNC
- Classification code
- Student ID number
- Last name
- First name
- Account balance
- Email address
- Last cleared semester
- Current enrollment indicator
- Current clearance indicator

Required features:

- Filter by category, classification, balance range, semester, and last-cleared value.
- Sort by category, classification, last name, and first name by default.
- Display the total positive receivable for the filtered population.
- Permit authorized CSV/XLSX export.
- Link each row to the Student Profile.
- Exclude duplicate students and document the key used for deduplication.

Business-rule validation is required before production. The supplied source query classifies DNC using the current term plus `ClearedCurrentSession = 0` and positive balance. It classifies DNR using the prior term plus `ClearedCurrentSession = 1` and positive balance. A subject-matter owner must confirm that the latter also proves non-enrollment in the current term.

## 9. Historical Analysis

### 9.1 Enrolled vs. Financially Cleared

- Group Fall and the following Spring into one academic year.
- Example: Fall 2025 and Spring 2026 are academic year 2025-2026.
- Display Fall Census, Spring Census, Fall Financially Cleared, and Spring Financially Cleared.
- Provide line and grouped-column views with a data table.
- Allow users to select an academic-year range and show clearance percentages.

### 9.2 Total Receivables and Credits

- Display total positive balances across `tblStudent` as Global Receivables.
- Display the absolute value of total negative balances as Global Credits/Payments.
- Do not label negative balances as payments unless the business owner confirms that interpretation.

### 9.3 Receivables by Semester

- Display semester/year and total positive balance for students whose `LastCleared` matches each `tblOUSA` Traditional or LEAP identifier.
- Include a trend chart, sortable table, and export.
- Support school-year grouping as well as individual semester display.

### 9.4 Historical Snapshots

Scheduled jobs must persist time-stamped aggregate snapshots so historical trend charts do not change retroactively without traceability. Store job ID, source timestamp, completion timestamp, status, record counts, and error details.

## 10. Student Lookup and Profile

### 10.1 Student Lookup

- Search by exact or partial student ID, last name, first name, and PID where authorized.
- Require a minimum search length for name searches.
- Return student ID, last name, first name, middle name, PID (masked unless needed), enrollment state, last enrolled semester, clearance state, and balance.
- Protect against wildcard abuse and parameterize all queries.

### 10.2 Profile Overview/Bio

Display core identity and contact data needed for the workflow. Minimize sensitive data and avoid showing fields that are not needed for billing analysis.

### 10.3 Student Payment Profile

- Read payment/credit transactions from Jenzabar Cloud `trans_hist` for the selected student where `TRANS_AMT < 0` and `SUBSID_CDE = 'AR'`, ordered newest first.
- Show the student's apparent out-of-pocket contribution relative to total credits when the required transaction categories can be reliably identified.
- Show whether the student is currently enrolled; otherwise show the last enrolled semester.
- Show account aging using administrator-approved aging buckets such as current, 1-30, 31-60, 61-90, and 90+ days.
- Provide transaction date, description/type, amount, source, running total if valid, and source freshness.

The contribution ratio and aging logic must be approved and documented before production; do not guess transaction-type semantics.

### 10.4 Academic Link

- Cross-reference STATS/FCA data with `VIEW_OURM_ACAD` to provide academic context relevant to financial-aid viability.
- Display authorized academic profile fields, including GPA when approved.
- Display enrollment counts by major using the correct academic view name confirmed during schema validation.
- Restrict academic data to users with an explicit permission and log access to student profiles.

### 10.5 Clearance Worksheet

- Locate the student in `VIEW_OURM_STATS` by `idnumber`.
- If `ClearedBy = 'sa'`, show that clearance was automatic and that no operator worksheet is available.
- Otherwise, retrieve and display the associated PDF worksheet.
- The PDF must be served through an authenticated endpoint; never expose a public storage URL.
- If no worksheet is found, show a clear not-available state without treating it as a system error.

## 11. Mail Merge and Exports

Authorized operators can create a mail-merge file from `VIEW_OURM_FCA` using selected criteria:

- Clearance status
- Amount needed to clear or balance range
- Student classification
- Semester
- Additional approved criteria

Requirements:

- Preview matching record count before file generation.
- Display and record active criteria.
- Allow the user to choose from an approved field list.
- Export CSV and optionally XLSX; prevent formulas from executing when values begin with `=`, `+`, `-`, or `@`.
- Log who created the export, when, filters used, row count, and file type.
- Apply a configurable maximum row count and permission check.
- Do not send email from the initial release; create a mail-merge data file only unless a later requirement authorizes messaging.

## 12. AI Analyses

AI features shall summarize selected dashboard metrics and identify notable trends or anomalies. They must:

- Operate only on server-prepared aggregate or appropriately minimized data.
- Cite the metric, period, filter set, and snapshot used for each observation.
- Clearly label generated narrative as AI-assisted.
- Separate facts from hypotheses and recommended questions.
- Never write to Jenzabar, modify a student record, determine eligibility, or make autonomous financial-aid decisions.
- Avoid sending names, student IDs, email addresses, or transaction-level data to an external model unless specifically approved and contractually protected.
- Allow administrators to disable AI globally.
- Retain prompt/model/output audit metadata according to institutional policy without unnecessarily retaining student data.

Initial AI modules:

- Current clearance pace and change since prior snapshot
- Enrollment vs. clearance historical trends
- Receivable trends by semester
- Classification groups that are materially below the overall clearance rate
- Data-quality warnings and unusual changes

## 13. Reports and Analyses

Create a report catalog with three initial groups:

### 13.1 Revenue Assessment

Provide configurable revenue-oriented views based on charges, credits, positive balances, and approved projected-collection assumptions. Projection formulas are TBD and must not be invented.

### 13.2 Receivable Analysis

Analyze current and historical receivables by semester, balance band, classification, enrollment/clearance status, and aging bucket.

### 13.3 Red Flag

Provide rule-based exception indicators such as high balance, aging threshold exceeded, enrolled but not cleared, conflicting status values, or missing metadata. Administrators must configure thresholds. Red Flag is an analyst cue, not a punitive or eligibility determination.

## 14. Administration

### 14.1 User Management

- CRUD operations for users, role assignments, activation/deactivation, and password/identity status.
- Prefer institutional single sign-on if available; otherwise use a secure identity provider rather than custom password storage.

### 14.2 Operator Profile Manager

Maintain operator source code, display name, active status, email/department if approved, and effective dates. Retain history so past records continue to resolve correctly.

### 14.3 JADI Metadata Management

Define and manage semester metadata, current/previous term flags, Traditional and LEAP names/keys, school-year mapping, census, financially cleared totals, sprint dates, and classification mappings. Validate that only one applicable current and previous term is active for each program context.

### 14.4 JADI Setup Website Upgrade

Replace or integrate the existing C# JADI metadata website. Before removal, inventory its screens, validation rules, scheduled tasks, integrations, and data writes. Preserve required behavior and provide a migration/rollback plan.

### 14.5 Jenzabar Cloud Connection

Store server name/IP, database/catalog, authentication settings, encryption options, and connectivity status in protected server configuration. Secrets must be encrypted or supplied through a secrets manager and never returned to the browser or logged.

### 14.6 Scheduled Refresh Jobs

Administrators can configure job frequency within safe minimums for:

- Enrolled vs. cleared
- Current receivable
- DNR/DNC summary
- Charges/credits/delta
- Clearance-sprint metrics
- Historical enrollment/clearance
- Total receivables
- Receivables by semester

Provide enable/disable, schedule, last run, next run, duration, status, rows processed, retry action, and error details. Prevent overlapping executions of the same job. A manual refresh must use the same audited job pipeline.

## 15. Data and Calculation Standards

- Treat database results as typed numeric/date values. Do not use SQL `FORMAT()` for API values; format in the presentation layer.
- Use parameterized queries or stored procedures and a read-only application login for source reporting data.
- Use a documented canonical student key, semester key, and academic-year rule.
- Define whether all counts represent unique students; use `COUNT(DISTINCT canonical_student_key)` where duplicates are possible.
- Normalize blank, null, and unknown classifications consistently.
- Use a single source of truth for Current Semester and Previous Semester.
- Record the timezone used for transaction dates, snapshots, and display. Default to the institution's local timezone, configurable by an administrator.
- Reconcile hero-card totals with drill-down row counts under the same filters.
- Validate table/view names during discovery, including the apparent `VIEW_OURM_ACAD` versus `OURM_VIEW_ACAD` inconsistency.

## 16. Suggested Technical Architecture

Claude should implement a modular web application using a currently supported framework. A suitable default is:

- Front end: Next.js with TypeScript and an accessible component library
- Server/API: Next.js server routes or a separate TypeScript service
- Source database: Microsoft SQL Server through a supported driver
- Application database: SQL Server or PostgreSQL for users, roles, configuration, snapshots, jobs, and audit records
- Authentication: institutional SSO via OpenID Connect/SAML when available
- Background jobs: durable scheduler/worker with database-backed job state
- Charts: accessible chart library with companion data tables
- Deployment: environment-based configuration, TLS, health checks, structured logs, and separate development/staging/production environments

Architecture is a recommendation, not a mandate. Claude must isolate database access in a repository/service layer and must not place SQL in UI components.

## 17. API Requirements

Use versioned JSON endpoints or equivalent server actions with authorization, validation, and audit controls. Suggested resources:

- `/api/v1/dashboard/current`
- `/api/v1/dashboard/clearance-by-date`
- `/api/v1/dashboard/clearance-by-operator`
- `/api/v1/dashboard/clearance-by-classification`
- `/api/v1/dnr-dnc`
- `/api/v1/history/enrollment-clearance`
- `/api/v1/history/receivables`
- `/api/v1/students/search`
- `/api/v1/students/{id}`
- `/api/v1/students/{id}/transactions`
- `/api/v1/students/{id}/academic`
- `/api/v1/students/{id}/worksheet`
- `/api/v1/exports/mail-merge`
- `/api/v1/admin/users`
- `/api/v1/admin/operators`
- `/api/v1/admin/metadata`
- `/api/v1/admin/schedules`
- `/api/v1/admin/jobs`

List endpoints must use server-side pagination and bounded page sizes. Return consistent error objects and correlation IDs. Do not expose SQL, connection details, stack traces, or internal identifiers unnecessarily.

## 18. Security, Privacy, and Audit Requirements

- Treat student identity, enrollment, financial, and academic records as sensitive and potentially FERPA-regulated.
- Enforce least privilege, server-side authorization, encrypted transport, secure cookies, CSRF protection where applicable, input validation, output encoding, rate limiting, and security headers.
- Use read-only credentials for Jenzabar/JADI reporting queries.
- Mask or omit student IDs, PID, email, and detailed balances in aggregate views unless needed.
- Audit sign-in events, student-profile access, worksheet access, exports, AI requests, administrative changes, schedule changes, and manual refreshes.
- Never log database passwords, access tokens, full query results, or generated export contents.
- Define retention rules for audit logs, snapshots, exports, and worksheets.
- Apply dependency scanning, secret scanning, code review, and vulnerability remediation before production.

## 19. Performance and Reliability

- Target initial aggregate-dashboard load within 3 seconds under normal institutional network conditions when using a current snapshot.
- Target filtered table responses within 5 seconds for expected production volumes.
- Use cached/snapshot data for expensive aggregate calculations; do not run every dashboard metric directly against operational views on every page load.
- Show stale-data warnings when the latest successful refresh exceeds a configurable threshold.
- Implement timeouts, bounded retries for transient failures, connection pooling, and graceful degradation by module.
- One failed metric must not blank the entire dashboard.
- Provide readiness and liveness health endpoints without exposing sensitive data.

## 20. Accessibility and Compatibility

- Meet WCAG 2.2 AA requirements.
- Support current and previous major versions of Chrome and Edge; support Safari when institutional users require it.
- All functions must be keyboard accessible.
- Use semantic headings, form labels, focus indicators, sufficient contrast, status text beyond color, and screen-reader-friendly table/chart alternatives.

## 21. Acceptance Criteria

The initial release is acceptable when:

1. An authorized user can sign in and sees only permitted modules.
2. Current enrolled, cleared, not-cleared, and clearance percentage values match approved validation SQL for the same snapshot.
3. Summary totals reconcile to their drill-down records.
4. Current receivable, charges, credits, and delta match approved source calculations.
5. DNC and DNR rules have written business-owner approval and test cases.
6. Clearance metrics can be grouped by date, operator, and classification, with totals.
7. Fall/Spring data are grouped into the correct academic year.
8. Users can search for a student, view permitted profile sections, and access a worksheet when available.
9. Authorized users can create a filtered, audited mail-merge export.
10. Administrators can manage users, operators, metadata, and schedules.
11. Failed or stale refreshes are visible and do not masquerade as zero values.
12. Student-level and export actions are audited.
13. Automated tests cover permissions, calculations, filters, APIs, and key failure states.
14. Accessibility testing identifies no unresolved critical violations.
15. Deployment documentation, environment-variable template, database migrations, seed metadata, backup/restore procedure, and rollback instructions are delivered.

## 22. Items Requiring Confirmation

Claude must create a visible `ASSUMPTIONS.md` and must not silently decide these items:

- Exact definition and source-of-truth query for DNR
- Whether counts are rows or unique students
- Canonical student identifier and masking rules
- Correct academic-view name and approved academic fields
- Meaning of negative balances and the correct label for them
- Account-aging date and bucket definitions
- Transaction categories used to calculate out-of-pocket contribution
- Revenue Assessment formulas
- Red Flag rules and thresholds
- Clearance Sprint start/end dates
- Approved export columns and viewer access to student data
- Institutional SSO method
- AI hosting/model, data-sharing approval, and retention policy
- Required branding, deployment platform, and expected concurrency/data volume

## 23. Required Deliverables from Claude

Claude shall produce:

1. A brief implementation plan and list of unresolved questions before coding.
2. A responsive interface prototype using realistic but synthetic data.
3. Database schema/migrations for application-owned data.
4. A typed data-access layer and isolated source-query definitions.
5. Authentication, authorization, and audit logging.
6. Scheduled refresh worker and job-status interface.
7. Dashboard, analysis, student, report, export, AI, and administration modules described above.
8. Unit, integration, authorization, and end-to-end tests.
9. Seed data and a mock-data mode that requires no production database.
10. Setup, configuration, deployment, backup, rollback, and operations documentation.
11. A traceability matrix mapping each requirement section to code and tests.

## 24. Claude Build Instructions

Use this requirements document as the authoritative functional baseline. Begin by returning:

1. A proposed architecture and repository structure.
2. A phased implementation plan.
3. A concise list of blocking questions from Section 22.
4. A page inventory and text wireframe for each primary page.
5. A proposed application schema and API contract.

Do not connect to a production database, use real student data, deploy, or implement write-back operations without explicit approval. Build first with synthetic fixtures and a data-access interface that can later be connected to read-only SQL Server views. Preserve supplied SQL as validation reference, but refactor it into parameterized, testable queries that return typed raw values. After approval of the architecture, implement in vertical slices, beginning with authentication/roles, metadata, the current-semester dashboard, and snapshot jobs.

## Appendix A - Source Data Objects Identified

- `ousadb.dbo.tblStudent`
- `ousadb.dbo.tblOUSA`
- `view_ourm_fca`
- `view_ourm_stats`
- `view_ourm_charges`
- `view_ourm_credits`
- `VIEW_OURM_ACAD` / `OURM_VIEW_ACAD` (name to be confirmed)
- `jenzabar_cloud.trans_hist`

## Appendix B - Core Formula Definitions

- Clearance percentage = cleared student count divided by enrolled student count multiplied by 100; return zero or N/A when enrolled is zero according to the approved display rule.
- Not cleared count = enrolled count minus cleared count only if both populations use the same unique-student universe; otherwise use the approved status-based query and explain differences.
- Charges/credits delta = total charges minus expected credits.
- Current receivable = sum of positive account balances for the approved current-term population.
- Global receivable = sum of all positive account balances in the defined population.
- Global credit = absolute value of the sum of negative account balances, with final business label pending.
