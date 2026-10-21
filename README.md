# As Majita Stokvel

A savings ledger and audit app for As Majita Stokvel. Members contribute monthly and the savings, with interest, are paid out on 20 December. The app applies the Stokvel's constitution automatically and shows:

- Total collected per month (on time vs after the 7th) and the running account balance, as charts
- A monthly totals table: collected, late, missed months, penalties, withdrawals
- A member ledger with each member's 12 months and status: good standing, late, in arrears, withdrawn or expelled
- What each member owes to get back in good standing
- A 20 December payout projection, with each member's interest share
- A form to record payments and add members, plus CSV import and export

It is plain HTML and JavaScript. There is no build step and no server.

## Run it

Open `index.html` in a browser. To serve it locally instead:

```bash
npm start        # serves the folder at http://localhost:3000
```


## Where the data is kept

By default the records are saved in the browser's local storage, so the data stays on one device. Use **Export payments CSV** as a backup.

When `js/firebase-config.js` has a Firebase config, the records are kept in Firestore instead. Every member then sees the same ledger after signing in with Google, and only admins can add or change records.

On the first run the app loads the 2026 register and payments up to September from `js/seed-data.js`. The spreadsheet had no payment dates, so each payment is dated the 1st of its month (on time). With Firebase, this data is written the first time an admin signs in, and only if the database is empty.

## Deploy to Firebase

1. In the [Firebase console](https://console.firebase.google.com), create a project. Add a **Web app** and copy its config.
2. Under **Build → Authentication → Sign-in method**, turn on **Google**.
3. Under **Build → Firestore Database**, create a database in production mode.
4. In `js/firebase-config.js`, paste the config into `FIREBASE_CONFIG` and list the admin emails in `STOKVEL_ADMINS`.
5. In `firestore.rules`, put the same admin emails in `isAdmin()` and the other members' emails in `isMember()`.
6. Deploy:

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # choose your project
firebase deploy               # hosting + Firestore rules
```

The Firebase web config is not a secret. Access is controlled by `firestore.rules`, so deploy the rules each time you change who can see or edit.

## How the constitution is applied

| Clause | Rule in the app |
|---|---|
| 4.1–4.4 | R300 minimum per month, due by the 7th. A month's first payment dated after the 7th is marked late. Paying more than R300 adds to savings. |
| 5.1–5.2 | A month with no payment at all is missed and costs a R50 penalty. The next payment settles the penalty first. Catching up after one missed month is R300 + R50 + R300 = R650. |
| 6 | Payout on 20 December: savings plus share of interest. |
| 7.1, 7.4 | A withdrawing member receives their savings less any unpaid penalties. Nothing is due after the withdrawal month. |
| 7.2 | Penalties still unpaid on 20 December are deducted from that member's savings. |
| 7.3, 8.1–8.2 | Interest is shared in proportion to savings, only among members who contributed in more than 7 months (8 or more). |
| 9.1–9.2 | Three missed months in a row means automatic expulsion and all savings are forfeited. |

The constitution does not cover some cases, so the app makes these choices:

- A partial payment (under R300) is not a skipped month. The shortfall shows as arrears, with no penalty.
- Penalties are Stokvel income, not member savings.
- Penalties and forfeited savings are listed separately for members to decide on by majority vote (12.3).

## CSV format

Imports and payment exports use these columns:

```csv
member,date,amount,note
Ndivhuwo Mathoma,2026-01-05,300,
Ndivhuwo Mathoma,2026-02-09,300,late
```

Dates can be `2026-01-05` or `05/01/2026`. A name that isn't in the register yet is added as a new member from the month of their first payment.

## Project layout

```
index.html            Page layout and styles
js/engine.js          The constitution rules (pure function, no UI)
js/app.js             Screens, forms, charts, CSV import/export
js/store.js           Saves records to Firestore, or the browser if Firebase is not set up
js/firebase-config.js Firebase project config and admin emails
firestore.rules       Who can read and write the Firestore records
firebase.json         Firebase Hosting and rules settings
js/seed-data.js       2026 members and payments loaded on first run
test/engine.test.js   Checks the rules against the 2026 data (npm test)
```

## Office bearers

Chairperson: Zwivhuya Rammela · Treasurer: Vhanga Mudzunga · Secretary: Ovhonala Makhera
