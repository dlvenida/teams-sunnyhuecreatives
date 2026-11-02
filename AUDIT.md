# Role UX audit

Walked every sidebar page on the PR branch as the seeded users: Jane (Admin, janelaurine@gmail.com), Audrey Reyes (Project Manager, auditor@sunnyhue.local), and Myra (VA, myra@sunnyhue.local). No page returned an error or a not-found screen. Direct visits to Invoices, VA Rates, and Settings as a Project Manager bounce back to the dashboard. Those items are not in that menu.

Money on a Project Manager screen: none. Pesos and dollars appear for Admin (business totals, rates, payroll) and for the VA (their own pay only).

## Admin

| Page | What they see | Issue | Fix or decision |
| --- | --- | --- | --- |
| Dashboard | Morning greeting, task counts, owner earnings in dollars | Owner money is correct for Admin | No change |
| Task Board | All tasks, comments | Copy said "Auditors" | Now says Project Managers |
| Projects | All projects and discussion | Same copy issue | Fixed |
| Time Clock | Own clock plus the team | Revision copy said "auditor" | Now says Project Manager |
| Log my time | Own time entry form, with rate and pay | Label was the same as a VA log, easy to mix up with All Logs | Menu and heading now say Log my time |
| All Logs | Team logs with pay and approve, reject, delete | None | No change |
| VA Payroll | Hours, peso and dollar totals, payslip, Mark Paid, status pills (pending approval, unpaid) | Opening the page used to wait on an empty custom range | Defaults to This Month |
| VA Rates | Rate requests and amounts | None | No change |
| Client Reports | Hours, amounts, Create Invoice | None for Admin | No change |
| Team Reports | Inbox of VA reports, status actions | Copy said Auditor | Now says Project Manager |
| Analytics | Activity board and who watches each VA | Title and column said Auditor | Title is Analytics. Column is Project Manager |
| Invoices | Invoice list and amounts | None | No change |
| Clients | Client list with rates | None | No change |
| Users | Admin, Project Manager, and VA tabs | Column said Auditing | Column is VAs assigned |
| Settings | Company, email, pricing | None | No change |
| Notifications | Mentions, timesheets, rate asks, inactive VAs, plus older time-log alerts already saved | Old "New time log" rows are still in the inbox from before the cleanup | Needs Jane: clear the old inbox once, or leave history |
| Profile | Account and theme | None | No change |

Menu items Admin should not see: none. Invoices, VA Rates, and Settings stay Admin only.

## Project Manager

| Page | What they see | Issue | Fix or decision |
| --- | --- | --- | --- |
| Dashboard | Same morning board as Admin, without owner earnings or peso and dollar totals | Sidebar name was "Audrey Auditor" because the worker profile was created under the old title | Demo name is Audrey Reyes, job title Project Manager |
| Task Board | All tasks. Can comment | Copy said Auditors | Fixed |
| Projects | All projects | Same | Fixed |
| Time Clock | Own clock and team clock. Can edit times | Copy said auditor | Fixed |
| Log my time | Own hours. No rate or pay fields | Easy to confuse with All Logs | Renamed Log my time |
| All Logs | Hours, status, approve and reject. No pay column, no delete | None found | No change |
| VA Payroll | Hours, pending approval and unpaid pills, review. No rates, totals, Mark Paid, or payslip | The export button said Payroll PDF even though it has no pay | Button now says Hours PDF |
| Client Reports | Hours only. No rate column | Create Invoice opened a page this role cannot use | Button hidden |
| Team Reports | Can read reports. Cannot change status | Copy said Auditors can only view | Copy now says Project Managers can read, only Admin changes status |
| Analytics | Activity, inactive reasons, no money | Column said Auditor | Now Project Manager |
| Clients | Client list, no rates. Can propose a client | Copy was fine | No change |
| Users | Profiles. Money fields hidden | Column said Auditing | Now VAs assigned |
| Notifications | Timesheet submissions, rate asks without amounts, inactive VA alerts | Older time-log rows may still be in history | Same inbox decision as Admin |
| Profile | Account. Role pill says Project Manager | None | No change |
| Invoices, VA Rates, Settings | Not in the menu. Typed URLs return to the dashboard | None | No change |

Money leak: not found on any Project Manager page in this walk.

## VA

| Page | What they see | Issue | Fix or decision |
| --- | --- | --- | --- |
| Dashboard | Own hours and peso totals, tasks due, approved status on the pay table | None | No change. Their own pay is supposed to show |
| Task Board | Own tasks | None | No change |
| Projects | Projects they can open | None | No change |
| Time Clock | Own clock. Revision note now names a Project Manager | None | Fixed the helper text |
| Log Time | Date, client, task name, description, hours, own rate and estimated pay | None | No change |
| My Payroll | Own pay by month, timesheet submit, logs grouped by week, paid and unpaid | None | No change |
| My Rates | Own rates and a request form | None | No change |
| Clients | Assigned clients and the role they set per client | None | No change |
| My Reports | Create a report and see status | Copy said Auditor | Now says Project Manager |
| Notifications | Their own alerts | None | No change |
| Profile | Account. Role pill says VA | None | No change |

Menu items a VA should not see: payroll for other people, invoices, settings, user admin, analytics. Those are not in the VA menu.

## Still needs Jane

- Old notification rows (time logs, clock activity) are already stored. New ones are not created. Say if the inbox should be cleared once.
- Project Managers can approve and reject individual time logs and timesheets, but they cannot delete logs or mark payroll paid. That split is in place. Confirm it is what you want.
- The demo Project Manager signs in as auditor@sunnyhue.local. The email stays the same. Only the name on screen changed, so the word Auditor does not appear in the product.

## Proposed arrangement

Jane liked the work. The menu was the confusing part. Workspace, Operations, and Manage mixed the morning jobs with money and settings. The dashboard also led with earnings, then advice, and only then the day.

The sidebar now follows the day. Pink styling is unchanged. Every old page is still reachable. Nothing was deleted.

### Admin

| Section | What is in it |
| --- | --- |
| Today | Dashboard, Time Clock, Log my time |
| Work | Task Board, Projects |
| Team | Timesheets & pay, Review logs, VA Rates |
| Money | Invoices, Earnings & expenses |
| Insights | One item. Tabs inside: Client hours, Team activity, Team inbox |
| Settings | Clients, Users, Company settings, Notifications, Profile |

### Project Manager

| Section | What is in it |
| --- | --- |
| Today | Dashboard, Time Clock, Log my time |
| Team Tasks | Task Board, Projects |
| Timesheet Review | Timesheet review, Review logs |
| Team Reports | One item. Same three tabs: Client hours, Team activity, Team inbox |
| People | Clients, Users, Notifications, Profile |

Project Managers still do not see Invoices, VA Rates, Earnings & expenses, or peso and dollar totals. Those URLs return to the dashboard.

### VA

| Section | What is in it |
| --- | --- |
| My Day | Dashboard, Clock in, Log time |
| My Tasks | Task Board, Projects |
| My Timesheets & Pay | Weekly timesheets, My Rates |
| More | Clients, My Reports, Notifications, Profile |

Weekly timesheets is the same payroll page, grouped Monday to Sunday, with the VA's own pay.

### What overlapped, and what we did

| Old pages | Decision |
| --- | --- |
| Client Reports, Team Reports, Analytics | Kept all three screens. They answer different questions: hours to bill, reports the team filed, and who was quiet. They now share one tab bar, so the sidebar is not three lookalike links. Bookmarks to /admin/reports, /admin/analytics, and /admin/user-reports still work. |
| All Logs and Log Time | Kept both. Log my time is your own entry. Review logs is the team list, with approve and reject. A two-tab switch sits on both pages so the difference is obvious. The old "All Logs" name is gone from the menu. |
| Dashboard pay table and VA payroll | The long pay table left the dashboard. The VA opens My Timesheets & Pay for the week, the pesos, and the submit button. |
| Owner earnings form | The full form, including expenses, lives under Money as Earnings & expenses. Today still shows the money totals, after the day's status, for Admin only. |

### Dashboard order

1. Key actions. Clock in and log time for a VA. Timesheet review for a Project Manager. Timesheets, the task board, and invoices for Admin.
2. Today's status. Due, overdue, done, what to prepare, current tasks, needs attention, the week ahead, then pending logs.
3. Money, Admin only. Totals, hours by client, VA pay this week, and a button into Earnings & expenses.
4. Smart advice last.

### Still needs Jane

- Say if Team inbox should also sit under Team for Admin, instead of only inside Insights.
- Say if People is the right name for the Project Manager's clients, users, and notifications.
